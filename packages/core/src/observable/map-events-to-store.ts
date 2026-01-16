import {
  catchError,
  distinct,
  EMPTY,
  filter,
  from,
  identity,
  mergeMap,
  mergeWith,
  MonoTypeOperatorFunction,
  of,
  share,
} from "rxjs";
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
  return (source) => {
    const shared = source.pipe(share());

    return shared.pipe(
      // Map all events to the store
      // NOTE: mergeMap is used here because we want to return the single instance of the event so that distinct() can be used later
      mergeMap((event) => {
        // Ignore strings
        if (typeof event === "string") return EMPTY;

        const r = store.add(event) as T | Promise<T>;

        // Unwrap the promise from the async store
        if (r instanceof Promise) return from(r);
        else return of(r);
      }),
      // Ignore errors when inserting events into the store
      catchError(() => of(null)),
      // Ignore invalid events
      filter((e) => e !== null),
      // Remove duplicates if requested
      removeDuplicates ? distinct() : identity,
      // Merge the strings back in if there are any
      mergeWith(shared.pipe(filter((e) => typeof e === "string"))),
    );
  };
}

/** Alias for {@link mapEventsToStore} */
export function filterDuplicateEvents<T extends NostrEvent | string>(
  store: IEventStoreActions | IAsyncEventStoreActions,
): MonoTypeOperatorFunction<T> {
  return mapEventsToStore(store, true);
}
