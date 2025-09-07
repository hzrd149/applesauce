import { NostrEvent } from "nostr-tools";
import { distinct, filter, identity, map, MonoTypeOperatorFunction } from "rxjs";

import { IEventStoreActions } from "../event-store/interface.js";

/** Saves all events to an event store and filters out invalid events */
export function mapEventsToStore(
  store: IEventStoreActions,
  removeDuplicates = true,
): MonoTypeOperatorFunction<NostrEvent> {
  return (source) =>
    source.pipe(
      // Map all events to the store
      // NOTE: map is used here because we want to return the single instance of the event so that distinct() can be used later
      map((event) => store.add(event)),
      // Ignore invalid events
      filter((e) => e !== null),
      // Remove duplicates if requested
      removeDuplicates ? distinct() : identity,
    );
}

/** Alias for {@link mapEventsToStore} */
export const filterDuplicateEvents = (store: IEventStoreActions) => mapEventsToStore(store, true);
