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
} from "../helpers/event.js";
import { Filter, matchFilters } from "../helpers/filter.js";
import { AddressPointer, AddressPointerWithoutD, EventPointer } from "../helpers/pointers.js";
import { claimEvents } from "../observable/claim-events.js";
import { claimLatest } from "../observable/claim-latest.js";

/** Gets a single event from both types of event stores and returns an observable that completes */
function getEventFromStores(
  store: IEventStore | IAsyncEventStore,
  pointer: EventPointer,
): Observable<NostrEvent | undefined> {
  const r = store.getEvent(pointer.id);

  if (r instanceof Promise) return from(r);
  else return of(r);
}

/** Gets a single replaceable event from both types of event stores and returns an observable that completes */
function getReplaceableFromStores(
  store: IEventStore | IAsyncEventStore,
  pointer: AddressPointer | AddressPointerWithoutD,
): Observable<NostrEvent | undefined> {
  const r = store.getReplaceable(pointer.kind, pointer.pubkey, pointer.identifier);

  if (r instanceof Promise) return from(r);
  else return of(r);
}

/** Gets events by filters from both types of event stores and returns an observable that emits each event */
function getByFiltersFromStores(
  store: IEventStore | IAsyncEventStore,
  filters: Filter | Filter[],
): Observable<NostrEvent> {
  const r = store.getByFilters(filters);

  if (r instanceof Promise) {
    return from(r).pipe(mergeMap((events) => from(events)));
  } else {
    return from(r);
  }
}

/** If event is undefined, attempt to load using the fallback loader */
function loadEventUsingFallback(
  store: IMissingEventLoader,
  pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
): MonoTypeOperatorFunction<NostrEvent | undefined> {
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
export function EventModel(
  pointer: string | EventPointer,
): Model<NostrEvent | undefined, IEventStore | IAsyncEventStore> {
  if (typeof pointer === "string") pointer = { id: pointer };

  return (store) =>
    merge(
      // get current event
      defer(() => getEventFromStores(store, pointer)).pipe(
        // If the event isn't found, attempt to load using the fallback loader
        store.eventLoader ? loadEventUsingFallback(store, pointer) : identity,
      ),
      // Listen for new events
      store.insert$.pipe(filter((e) => e.id === pointer.id)),
      // emit undefined when deleted
      store.remove$.pipe(
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
      claimLatest(store),
    );
}

/** A model that returns the latest version of a replaceable event or undefined if its removed */
export function ReplaceableModel(
  pointer: AddressPointer | AddressPointerWithoutD,
): Model<NostrEvent | undefined, IEventStore | IAsyncEventStore> {
  return (store) => {
    let current: NostrEvent | undefined = undefined;

    return merge(
      // lazily get current event
      defer(() => getReplaceableFromStores(store, pointer)).pipe(
        // If the event isn't found, attempt to load using the fallback loader
        store.eventLoader ? loadEventUsingFallback(store, pointer) : identity,
      ),
      // Subscribe to new events that match the pointer
      store.insert$.pipe(
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
        store.remove$.pipe(
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
      claimLatest(store),
    );
  };
}

/** A model that returns an array of sorted events matching the filters */
export function TimelineModel(
  filters: Filter | Filter[],
  includeOldVersion?: boolean,
): Model<NostrEvent[], IEventStore | IAsyncEventStore> {
  filters = Array.isArray(filters) ? filters : [filters];

  return (store) => {
    const seen = new Map<string, NostrEvent>();

    // get current events
    return defer(() => {
      const r = store.getTimeline(filters);
      if (r instanceof Promise) return from(r);
      else return of(r);
    }).pipe(
      // claim existing events
      claimEvents(store),
      // subscribe to newer events
      mergeWith(
        store.insert$.pipe(
          filter((e) => matchFilters(filters, e)),
          // claim all new events
          claimEvents(store),
        ),
      ),
      // subscribe to delete events
      mergeWith(
        store.remove$.pipe(
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
          // Always return a new array instance to ensure UI libraries detect changes
          return [...event];
        }

        // create a new timeline and insert the event into it
        let newTimeline = [...timeline];

        // remove old replaceable events if enabled
        if (!includeOldVersion && isReplaceable(event.kind)) {
          const uid = getEventUID(event);
          const existing = seen.get(uid);
          // if this is an older replaceable event, return a new array instance
          if (existing && event.created_at < existing.created_at) return [...timeline];
          // update latest version
          seen.set(uid, event);
          // remove old event from timeline
          if (existing) {
            const index = newTimeline.indexOf(existing);
            if (index !== -1) newTimeline.splice(index, 1);
          }
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

/** A model that streams all events that match the filters */
export function FiltersModel(
  filters: Filter | Filter[],
  onlyNew = false,
): Model<NostrEvent, IEventStore | IAsyncEventStore> {
  filters = Array.isArray(filters) ? filters : [filters];

  return (store) => {
    // Create the existing events observable
    const existingEvents$: Observable<NostrEvent> = onlyNew
      ? EMPTY
      : defer(() => getByFiltersFromStores(store, filters));

    // Create the new events observable
    const newEvents$: Observable<NostrEvent> = store.insert$.pipe(filter((e) => matchFilters(filters, e)));

    return merge(existingEvents$, newEvents$);
  };
}
