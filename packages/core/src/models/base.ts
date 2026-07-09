import {
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  from,
  identity,
  map,
  merge,
  mergeMap,
  mergeWith,
  MonoTypeOperatorFunction,
  Observable,
  of,
  scan,
  startWith,
  switchMap,
  take,
  tap,
} from "rxjs";

import { IAsyncEventStore, IEventStore, IMissingEventLoader, Model } from "../event-store/interface.js";
import {
  getEventUID,
  getReplaceableIdentifier,
  insertEventIntoDescendingList,
  isReplaceable,
  NostrEvent,
  StoreEvent,
} from "../helpers/event.js";
import { Filter, matchFilters } from "../helpers/filter.js";
import { AddressPointer, AddressPointerWithoutD, EventPointer } from "../helpers/pointers.js";
import { claimEvents } from "../observable/claim-events.js";
import { claimLatest } from "../observable/claim-latest.js";

/** Gets a single event from both types of event stores and returns an observable that completes */
function getEventFromStores<E extends StoreEvent = NostrEvent>(
  store: IEventStore<E> | IAsyncEventStore<E>,
  pointer: EventPointer,
): Observable<E | undefined> {
  const r = store.getEvent(pointer.id);

  if (r instanceof Promise) return from(r);
  else return of(r);
}

/** Gets a single replaceable event from both types of event stores and returns an observable that completes */
function getReplaceableFromStores<E extends StoreEvent = NostrEvent>(
  store: IEventStore<E> | IAsyncEventStore<E>,
  pointer: AddressPointer | AddressPointerWithoutD,
): Observable<E | undefined> {
  const r = store.getReplaceable(pointer.kind, pointer.pubkey, pointer.identifier);

  if (r instanceof Promise) return from(r);
  else return of(r);
}

/** Gets events by filters from both types of event stores and returns an observable that emits each event */
function getByFiltersFromStores<E extends StoreEvent = NostrEvent>(
  store: IEventStore<E> | IAsyncEventStore<E>,
  filters: Filter | Filter[],
): Observable<E> {
  const r = store.getByFilters(filters);

  if (r instanceof Promise) {
    return from(r).pipe(mergeMap((events) => from(events)));
  } else {
    return from(r);
  }
}

/** If event is undefined, attempt to load using the fallback loader */
function loadEventUsingFallback<E extends StoreEvent = NostrEvent>(
  store: IMissingEventLoader<E>,
  pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
): MonoTypeOperatorFunction<E | undefined> {
  return switchMap((event) => {
    if (event) return of(event);

    // If no loader pass value through, should never happen
    if (!store.eventLoader) return of(event);

    // If event was not found, attempt to load
    return from(store.eventLoader(pointer)).pipe(
      // Start with `undefined` since its not loaded yet
      startWith(undefined),
    );
  });
}

/** A model that returns a single event or undefined when its removed */
export function EventModel<E extends StoreEvent = NostrEvent>(pointer: string | EventPointer): Model<E | undefined> {
  if (typeof pointer === "string") pointer = { id: pointer };

  return (store) => {
    // Bridge cast: `Model`'s TStore is still bare (NostrEvent-only) until Wave 2 threads `E`
    // through `ModelEventStore`/`IEventSubscriptions` (event-store/interface.ts); the runtime
    // store is already E-shaped, so this cast is a no-op for the default NostrEvent case.
    const s = store as unknown as IEventStore<E> | IAsyncEventStore<E>;

    return merge(
      // get current event
      defer(() => getEventFromStores(s, pointer)).pipe(
        // If the event isn't found, attempt to load using the fallback loader
        s.eventLoader ? loadEventUsingFallback(s, pointer) : identity,
      ),
      // Listen for new events
      s.insert$.pipe(filter((e) => e.id === pointer.id)),
      // emit undefined when deleted
      s.remove$.pipe(
        filter((e) => e.id === pointer.id),
        // Complete when the event is removed
        take(1),
        // Emit undefined when deleted
        map(() => undefined),
      ),
    ).pipe(
      // ignore duplicate events (true === same)
      distinctUntilChanged((a, b) => a?.id === b?.id),
      // claim all events
      claimLatest(s),
    );
  };
}

/** A model that returns the latest version of a replaceable event or undefined if its removed */
export function ReplaceableModel<E extends StoreEvent = NostrEvent>(
  pointer: AddressPointer | AddressPointerWithoutD,
): Model<E | undefined> {
  return (store) => {
    // Bridge cast: see EventModel's comment above.
    const s = store as unknown as IEventStore<E> | IAsyncEventStore<E>;

    let current: E | undefined = undefined;

    return merge(
      // lazily get current event
      defer(() => getReplaceableFromStores(s, pointer)).pipe(
        // If the event isn't found, attempt to load using the fallback loader
        s.eventLoader ? loadEventUsingFallback(s, pointer) : identity,
      ),
      // Subscribe to new events that match the pointer
      s.insert$.pipe(
        filter(
          (e) =>
            e.pubkey == pointer.pubkey &&
            e.kind === pointer.kind &&
            (pointer.identifier !== undefined ? getReplaceableIdentifier(e) === pointer.identifier : true),
        ),
      ),
    ).pipe(
      // Hacky way to extract the current event so it can be used in the remove$ stream
      tap((event) => (current = event)),
      // Subscribe to the event being removed
      mergeWith(
        s.remove$.pipe(
          filter((e) => {
            return e.id === current?.id;
          }),
          // Emit undefined when the event is removed
          map(() => {
            return undefined;
          }),
        ),
      ),
      // only update if event is newer (true === same)
      distinctUntilChanged((prev, event) => {
        // If the event has changed from undefined to defined or vice versa
        if (prev === undefined || event === undefined) {
          return prev === event;
        }

        // Return if event is newer than the previous event
        return event.created_at < prev.created_at;
      }),
      // claim latest event
      claimLatest(s),
    );
  };
}

/** A model that returns an array of sorted events matching the filters */
export function TimelineModel<E extends StoreEvent = NostrEvent>(
  filters: Filter | Filter[],
  includeOldVersion?: boolean,
): Model<E[]> {
  filters = Array.isArray(filters) ? filters : [filters];

  return (store) => {
    // Bridge cast: see EventModel's comment above.
    const s = store as unknown as IEventStore<E> | IAsyncEventStore<E>;

    const seen = new Map<string, E>();
    const getTimelineUID = (event: E) => (includeOldVersion ? event.id : getEventUID(event));

    // get current events
    return defer(() => {
      const r = s.getTimeline(filters);
      if (r instanceof Promise) return from(r);
      else return of(r);
    }).pipe(
      // claim existing events
      claimEvents(s),
      // subscribe to newer events
      mergeWith(
        s.insert$.pipe(
          filter((e) => matchFilters(filters, e)),
          // claim all new events
          claimEvents(s),
        ),
      ),
      // subscribe to delete events
      mergeWith(
        s.remove$.pipe(
          filter((e) => matchFilters(filters, e)),
          map((e) => e.id),
        ),
      ),
      // build a timeline
      scan((timeline, event) => {
        // filter out removed events from timeline
        if (typeof event === "string") {
          // Forget the removed event so the seen map does not grow unbounded on long-lived
          // feeds. Only forget when the seen entry is the event being removed (not a newer
          // replaceable version that happens to share a UID).
          const removed = timeline.find((e) => e.id === event);
          if (removed) {
            const uid = getTimelineUID(removed);
            if (seen.get(uid)?.id === event) seen.delete(uid);
          }
          return timeline.filter((e) => e.id !== event);
        }

        // initial timeline array
        if (Array.isArray(event)) {
          seen.clear();
          for (const e of event) seen.set(getTimelineUID(e), e);
          // Always return a new array instance to ensure UI libraries detect changes
          return [...event];
        }

        // create a new timeline and insert the event into it
        let newTimeline = [...timeline];
        const uid = getTimelineUID(event);
        const existing = seen.get(uid);

        // Ignore duplicate regular events and older replaceable versions.
        if (
          existing &&
          (!isReplaceable(event.kind) || (!includeOldVersion && event.created_at < existing.created_at))
        ) {
          return [...timeline];
        }

        // remove old replaceable events if enabled
        if (!includeOldVersion && isReplaceable(event.kind)) {
          // update latest version
          seen.set(uid, event);
          // remove old event from timeline
          if (existing) {
            const index = newTimeline.indexOf(existing);
            if (index !== -1) newTimeline.splice(index, 1);
          }
        } else {
          seen.set(uid, event);
        }

        // add event into timeline
        // NOTE: insertEventIntoDescendingList is not in the CORE-04 list and stays NostrEvent-typed;
        // bridge with a localized cast since it only reads `created_at` (present on every StoreEvent).
        insertEventIntoDescendingList(newTimeline as unknown as NostrEvent[], event as unknown as NostrEvent);

        return newTimeline;
      }, [] as E[]),
      // ignore changes that do not modify the timeline instance
      distinctUntilChanged(),
      // hacky hack to clear seen on unsubscribe
      finalize(() => seen.clear()),
    );
  };
}

/** A model that streams all events that match the filters */
export function FiltersModel<E extends StoreEvent = NostrEvent>(filters: Filter | Filter[], onlyNew = false): Model<E> {
  filters = Array.isArray(filters) ? filters : [filters];

  return (store) => {
    // Bridge cast: see EventModel's comment above.
    const s = store as unknown as IEventStore<E> | IAsyncEventStore<E>;

    // Create the existing events observable
    const existingEvents$: Observable<E> = onlyNew ? EMPTY : defer(() => getByFiltersFromStores(s, filters));

    // Create the new events observable
    const newEvents$: Observable<E> = s.insert$.pipe(filter((e) => matchFilters(filters, e)));

    return merge(existingEvents$, newEvents$);
  };
}
