import { NostrEvent } from "../helpers/event.js";
import { filter, map, merge, MonoTypeOperatorFunction, tap } from "rxjs";
import { IEventStoreStreams } from "../event-store/interface.js";

/** Watches for any updates to the latest event and remits the event when updated */
export function watchEventUpdates(eventStore: IEventStoreStreams): MonoTypeOperatorFunction<NostrEvent | undefined> {
  return (source) => {
    let latest: NostrEvent | undefined;

    return merge(
      // Get the latest event
      source.pipe(tap((value) => (latest = value))),
      // listen for updates
      eventStore.update$.pipe(filter((e) => e.id === latest?.id)),
    );
  };
}

/** Watches for any updates to the latest array of events and remits the array of events when updated */
export function watchEventsUpdates(eventStore: IEventStoreStreams): MonoTypeOperatorFunction<NostrEvent[]> {
  return (source) => {
    let latest: NostrEvent[] = [];

    return merge(
      // Get the latest event
      source.pipe(tap((value) => (latest = value))),
      // listen for updates
      eventStore.update$.pipe(
        filter((e) => latest.includes(e)),
        // re-emit the array of events
        map(() => latest),
      ),
    );
  };
}
