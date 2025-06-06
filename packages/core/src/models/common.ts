import { Filter, NostrEvent } from "nostr-tools";
import {
  defer,
  distinctUntilChanged,
  EMPTY,
  endWith,
  filter,
  finalize,
  from,
  map,
  merge,
  mergeWith,
  of,
  repeat,
  scan,
  takeUntil,
  tap,
} from "rxjs";

import { Model } from "../event-store/interface.js";
import {
  createReplaceableAddress,
  getEventUID,
  getReplaceableIdentifier,
  isReplaceable,
  matchFilters,
} from "../helpers/index.js";
import { claimEvents } from "../observable/claim-events.js";
import { claimLatest } from "../observable/claim-latest.js";
import { insertEventIntoDescendingList } from "nostr-tools/utils";
import { withImmediateValueOrDefault } from "../observable/with-immediate-value.js";

/** A model that returns a single event or undefined when its removed */
export function EventModel(id: string): Model<NostrEvent | undefined> {
  return (events) =>
    merge(
      // get current event and ignore if there is none
      defer(() => {
        let event = events.getEvent(id);
        return event ? of(event) : EMPTY;
      }),
      // subscribe to updates
      events.insert$.pipe(filter((e) => e.id === id)),
      // subscribe to updates
      events.updated(id),
      // emit undefined when deleted
      events.removed(id).pipe(endWith(undefined)),
    ).pipe(
      // claim all events
      claimLatest(events),
      // always emit undefined so the observable is synchronous
      withImmediateValueOrDefault(undefined),
    );
}

/** A model that returns the latest version of a replaceable event or undefined if its removed */
export function ReplaceableModel(kind: number, pubkey: string, d?: string): Model<NostrEvent | undefined> {
  return (events) => {
    let current: NostrEvent | undefined = undefined;

    return merge(
      // lazily get current event
      defer(() => {
        let event = events.getReplaceable(kind, pubkey, d);
        return event ? of(event) : EMPTY;
      }),
      // subscribe to new events
      events.insert$.pipe(
        filter(
          (e) => e.pubkey == pubkey && e.kind === kind && (d !== undefined ? getReplaceableIdentifier(e) === d : true),
        ),
      ),
    ).pipe(
      // only update if event is newer
      distinctUntilChanged((prev, event) => {
        // are the events the same? i.e. is the prev event older
        return prev.created_at >= event.created_at;
      }),
      // Hacky way to extract the current event so takeUntil can access it
      tap((event) => (current = event)),
      // complete when event is removed
      takeUntil(events.remove$.pipe(filter((e) => e.id === current?.id))),
      // emit undefined when removed
      endWith(undefined),
      // keep the observable hot
      repeat(),
      // claim latest event
      claimLatest(events),
      // always emit undefined so the observable is synchronous
      withImmediateValueOrDefault(undefined),
    );
  };
}

/** A model that returns an array of sorted events matching the filters */
export function TimelineModel(filters: Filter | Filter[], includeOldVersion?: boolean): Model<NostrEvent[]> {
  filters = Array.isArray(filters) ? filters : [filters];

  return (events) => {
    const seen = new Map<string, NostrEvent>();

    // get current events
    return defer(() => of(Array.from(events.getTimeline(filters)))).pipe(
      // claim existing events
      claimEvents(events),
      // subscribe to newer events
      mergeWith(
        events.insert$.pipe(
          filter((e) => matchFilters(filters, e)),
          // claim all new events
          claimEvents(events),
        ),
      ),
      // subscribe to delete events
      mergeWith(
        events.remove$.pipe(
          filter((e) => matchFilters(filters, e)),
          map((e) => e.id),
        ),
      ),
      // build a timeline
      scan((timeline, event) => {
        // filter out removed events from timeline
        if (typeof event === "string") return timeline.filter((e) => e.id !== event);

        // initial timeline array
        if (Array.isArray(event)) {
          if (!includeOldVersion) {
            for (const e of event) if (isReplaceable(e.kind)) seen.set(getEventUID(e), e);
          }
          return event;
        }

        // create a new timeline and insert the event into it
        let newTimeline = [...timeline];

        // remove old replaceable events if enabled
        if (!includeOldVersion && isReplaceable(event.kind)) {
          const uid = getEventUID(event);
          const existing = seen.get(uid);
          // if this is an older replaceable event, exit
          if (existing && event.created_at < existing.created_at) return timeline;
          // update latest version
          seen.set(uid, event);
          // remove old event from timeline
          if (existing) newTimeline.slice(newTimeline.indexOf(existing), 1);
        }

        // add event into timeline
        insertEventIntoDescendingList(newTimeline, event);

        return newTimeline;
      }, [] as NostrEvent[]),
      // ignore changes that do not modify the timeline instance
      distinctUntilChanged(),
      // hacky hack to clear seen on unsubscribe
      finalize(() => seen.clear()),
    );
  };
}

/** A model that returns a multiple events in a map */
export function EventsModel(ids: string[]): Model<Record<string, NostrEvent>> {
  return (events) =>
    merge(
      // lazily get existing events
      defer(() => from(ids.map((id) => events.getEvent(id)))),
      // subscribe to new events
      events.insert$.pipe(filter((e) => ids.includes(e.id))),
      // subscribe to updates
      events.update$.pipe(filter((e) => ids.includes(e.id))),
    ).pipe(
      // ignore empty messages
      filter((e) => !!e),
      // claim all events until cleanup
      claimEvents(events),
      // watch for removed events
      mergeWith(
        events.remove$.pipe(
          filter((e) => ids.includes(e.id)),
          map((e) => e.id),
        ),
      ),
      // merge all events into a directory
      scan(
        (dir, event) => {
          if (typeof event === "string") {
            // delete event by id
            const clone = { ...dir };
            delete clone[event];
            return clone;
          } else {
            // add even to directory
            return { ...dir, [event.id]: event };
          }
        },
        {} as Record<string, NostrEvent>,
      ),
    );
}

/** A model that returns a directory of events by their UID */
export function ReplaceableSetModel(
  pointers: { kind: number; pubkey: string; identifier?: string }[],
): Model<Record<string, NostrEvent>> {
  return (events) => {
    const uids = new Set(pointers.map((p) => createReplaceableAddress(p.kind, p.pubkey, p.identifier)));

    return merge(
      // start with existing events
      defer(() => from(pointers.map((p) => events.getReplaceable(p.kind, p.pubkey, p.identifier)))),
      // subscribe to new events
      events.insert$.pipe(filter((e) => isReplaceable(e.kind) && uids.has(getEventUID(e)))),
    ).pipe(
      // filter out undefined
      filter((e) => !!e),
      // claim all events
      claimEvents(events),
      // convert events to add commands
      map((e) => ["add", e] as const),
      // watch for removed events
      mergeWith(
        events.remove$.pipe(
          filter((e) => isReplaceable(e.kind) && uids.has(getEventUID(e))),
          map((e) => ["remove", e] as const),
        ),
      ),
      // reduce events into directory
      scan(
        (dir, [action, event]) => {
          const uid = getEventUID(event);

          if (action === "add") {
            // add event to dir if its newer
            if (!dir[uid] || dir[uid].created_at < event.created_at) return { ...dir, [uid]: event };
          } else if (action === "remove" && dir[uid] === event) {
            // remove event from dir
            let newDir = { ...dir };
            delete newDir[uid];
            return newDir;
          }

          return dir;
        },
        {} as Record<string, NostrEvent>,
      ),
      // ignore changes that do not modify the directory
      distinctUntilChanged(),
    );
  };
}
