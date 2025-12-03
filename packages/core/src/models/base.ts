import {
  defer,
  distinctUntilChanged,
  EMPTY,
  endWith,
  filter,
  finalize,
  from,
  ignoreElements,
  map,
  merge,
  mergeMap,
  mergeWith,
  MonoTypeOperatorFunction,
  Observable,
  of,
  repeat,
  scan,
  switchMap,
  take,
  takeUntil,
  tap,
} from "rxjs";

import { IAsyncEventStore, IMissingEventLoader, IEventStore, Model } from "../event-store/interface.js";
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
import { defined } from "../observable/defined.js";

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

    // If event was not found, attempt to load
    if (!store.eventLoader) return EMPTY;
    return from(store.eventLoader(pointer)).pipe(filter((e) => !!e));
  });
}

/** A model that returns a single event or undefined when its removed */
export function EventModel(
  pointer: string | EventPointer,
): Model<NostrEvent | undefined, IEventStore | IAsyncEventStore> {
  if (typeof pointer === "string") pointer = { id: pointer };

  return (store) =>
    merge(
      // get current event and ignore if there is none
      defer(() => getEventFromStores(store, pointer)).pipe(
        // If the event isn't found, attempt to load using the fallback loader
        loadEventUsingFallback(store, pointer),
        // Only emit found events
        defined(),
      ),
      // Listen for new events
      store.insert$.pipe(filter((e) => e.id === pointer.id)),
      // emit undefined when deleted
      store.remove$.pipe(
        filter((e) => e.id === pointer.id),
        take(1),
        ignoreElements(),
        // Emit undefined when deleted
        endWith(undefined),
      ),
    ).pipe(
      // claim all events
      claimLatest(store),
      // ignore duplicate events
      distinctUntilChanged((a, b) => a?.id === b?.id),
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
        loadEventUsingFallback(store, pointer),
        // Only emit found events
        defined(),
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
      // only update if event is newer
      distinctUntilChanged((prev, event) => {
        // are the events the same? i.e. is the prev event older
        return prev.created_at >= event.created_at;
      }),
      // Hacky way to extract the current event so takeUntil can access it
      tap((event) => (current = event)),
      // complete when event is removed
      takeUntil(store.remove$.pipe(filter((e) => e.id === current?.id))),
      // emit undefined when removed
      endWith(undefined),
      // keep the observable hot
      repeat(),
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
