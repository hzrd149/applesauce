import { MonoTypeOperatorFunction, Observable } from "rxjs";
import { IAsyncEventStoreActions, IEventStoreActions } from "../event-store/interface.js";
import type { NostrEvent } from "../helpers/event.js";

/**
 * Saves all events to an event store and filters out invalid events
 * If a string is passed in, it will be passed through
 */
export function mapEventsToStore<T extends NostrEvent | string>(
  store: IEventStoreActions | IAsyncEventStoreActions,
  removeDuplicates = true,
): MonoTypeOperatorFunction<T> {
  return (source) =>
    new Observable<T>((observer) => {
      // The store returns its single instance of each event, so duplicates are found by identity without holding them
      const seen = removeDuplicates ? new WeakSet<object>() : undefined;
      let pending = 0;
      let done = false;

      const emit = (event: T | null | undefined) => {
        // Ignore invalid events
        if (event === null || event === undefined) return;
        if (seen && typeof event === "object") {
          if (seen.has(event)) return;
          seen.add(event);
        }
        observer.next(event);
      };

      const sub = source.subscribe({
        next: (event) => {
          // Pass strings through
          if (typeof event === "string") return observer.next(event);

          // Skip events the store fails to insert, without ending the stream
          let result: T | null | Promise<T | null>;
          try {
            result = store.add(event) as T | null | Promise<T | null>;
          } catch {
            return;
          }

          if (!(result instanceof Promise)) return emit(result);

          // Unwrap the promise from the async store
          pending++;
          result
            .then(emit, () => {})
            .finally(() => {
              pending--;
              if (done && pending === 0) observer.complete();
            });
        },
        error: (err) => observer.error(err),
        complete: () => {
          done = true;
          if (pending === 0) observer.complete();
        },
      });

      return () => sub.unsubscribe();
    });
}

/** Alias for {@link mapEventsToStore} */
export function filterDuplicateEvents<T extends NostrEvent | string>(
  store: IEventStoreActions | IAsyncEventStoreActions,
): MonoTypeOperatorFunction<T> {
  return mapEventsToStore(store, true);
}
