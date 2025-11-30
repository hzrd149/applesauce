import { NostrEvent } from "../helpers/event.js";
import { catchError, distinct, filter, from, identity, mergeMap, MonoTypeOperatorFunction, of } from "rxjs";

import { IAsyncEventStoreActions, IEventStoreActions } from "../event-store/interface.js";

/** Saves all events to an event store and filters out invalid events */
export function mapEventsToStore(
  store: IEventStoreActions | IAsyncEventStoreActions,
  removeDuplicates = true,
): MonoTypeOperatorFunction<NostrEvent> {
  return (source) =>
    source.pipe(
      // Map all events to the store
      // NOTE: mergeMap is used here because we want to return the single instance of the event so that distinct() can be used later
      mergeMap((event) => {
        const r = store.add(event);

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
    );
}

/** Alias for {@link mapEventsToStore} */
export const filterDuplicateEvents = (store: IEventStoreActions | IAsyncEventStoreActions) =>
  mapEventsToStore(store, true);
