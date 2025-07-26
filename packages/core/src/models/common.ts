import { Filter, NostrEvent } from "nostr-tools";
import {
  combineLatest,
  defer,
  distinctUntilChanged,
  EMPTY,
  endWith,
  filter,
  finalize,
  map,
  merge,
  mergeWith,
  of,
  repeat,
  scan,
  takeUntil,
  tap,
} from "rxjs";

import { AddressPointer, EventPointer } from "nostr-tools/nip19";
import { insertEventIntoDescendingList } from "nostr-tools/utils";
import { Model } from "../event-store/interface.js";
import {
  AddressPointerWithoutD,
  createReplaceableAddress,
  getEventUID,
  getReplaceableIdentifier,
  isReplaceable,
  matchFilters,
} from "../helpers/index.js";
import { claimEvents } from "../observable/claim-events.js";
import { claimLatest } from "../observable/claim-latest.js";
import { withImmediateValueOrDefault } from "../observable/with-immediate-value.js";

/** A model that returns a single event or undefined when its removed */
export function EventModel(pointer: string | EventPointer): Model<NostrEvent | undefined> {
  if (typeof pointer === "string") pointer = { id: pointer };

  return (events) =>
    merge(
      // get current event and ignore if there is none
      defer(() => {
        let event = events.getEvent(pointer.id);
        if (event) return of(event);

        // If there is a loader, use it to get the event
        return events.eventLoader?.(pointer) ?? EMPTY;
      }),
      // Listen for new events
      events.insert$.pipe(filter((e) => e.id === pointer.id)),
      // emit undefined when deleted
      events.removed(pointer.id).pipe(endWith(undefined)),
    ).pipe(
      // claim all events
      claimLatest(events),
      // ignore duplicate events
      distinctUntilChanged((a, b) => a?.id === b?.id),
      // always emit undefined so the observable is synchronous
      withImmediateValueOrDefault(undefined),
    );
}

/** A model that returns the latest version of a replaceable event or undefined if its removed */
export function ReplaceableModel(pointer: AddressPointer | AddressPointerWithoutD): Model<NostrEvent | undefined> {
  return (events) => {
    let current: NostrEvent | undefined = undefined;

    return merge(
      // lazily get current event
      defer(() => {
        let event = events.getReplaceable(pointer.kind, pointer.pubkey, pointer.identifier);

        if (event) return of(event);
        else if (pointer.identifier !== undefined)
          return events.addressableLoader?.(pointer as AddressPointer) ?? EMPTY;
        else return events.replaceableLoader?.(pointer) ?? EMPTY;
      }),
      // subscribe to new events
      events.insert$.pipe(
        filter(
          (e) =>
            e.pubkey == pointer.pubkey &&
            e.kind === pointer.kind &&
            (pointer.identifier !== undefined ? getReplaceableIdentifier(e) === pointer.identifier : true),
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

/**
 * A model that returns a multiple events in a map
 * @deprecated use multiple {@link EventModel} instead
 */
export function EventsModel(ids: string[]): Model<Record<string, NostrEvent | undefined>> {
  return (events) => combineLatest(Object.fromEntries(ids.map((id) => [id, events.model(EventModel, { id })])));
}

/**
 * A model that returns a directory of events by their UID
 * @deprecated use multiple {@link ReplaceableModel} instead
 */
export function ReplaceableSetModel(
  pointers: (AddressPointer | AddressPointerWithoutD)[],
): Model<Record<string, NostrEvent | undefined>> {
  return (events) =>
    combineLatest(
      Object.fromEntries(
        pointers.map((pointer) => [
          createReplaceableAddress(pointer.kind, pointer.pubkey, pointer.identifier),
          events.model(ReplaceableModel, pointer),
        ]),
      ),
    );
}
