import { NostrEvent } from "../helpers/event.js";
import { defer, filter, map, merge, MonoTypeOperatorFunction, tap } from "rxjs";
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

/**
 * Re-emits the latest array when one of its event objects updates
 * @note Membership is indexed on each source emission; re-emit the array after adding, removing, or replacing events
 */
export function watchEventsUpdates(eventStore: IEventStoreStreams): MonoTypeOperatorFunction<NostrEvent[]> {
  return (source) =>
    defer(() => {
      let latest: NostrEvent[] = [];
      let members = new Set<NostrEvent>();

      return merge(
        // Get the latest event
        source.pipe(
          tap((value) => {
            latest = value;
            members = new Set(value);
          }),
        ),
        // listen for updates
        eventStore.update$.pipe(
          filter((e) => members.has(e)),
          // re-emit the array of events
          map(() => latest),
        ),
      );
    });
}

/** Alias for watchEventsUpdates */
export const watchTimelineUpdates = watchEventsUpdates;
