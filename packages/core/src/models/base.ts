import {
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  from,
  identity,
  map,
  merge,
  mergeMap,
  mergeWith,
  MonoTypeOperatorFunction,
  Observable,
  of,
  startWith,
  switchMap,
  take,
  tap,
} from "rxjs";

import { IAsyncEventStore, IEventStore, IMissingEventLoader, Model } from "../event-store/interface.js";
import { getKeyedRouter } from "../observable/keyed-router.js";
import { getReplaceableIdentifier, NostrEvent, StoreEvent } from "../helpers/event.js";
import { compileFilters, Filter } from "../helpers/filter.js";
import { AddressPointer, AddressPointerWithoutD, EventPointer } from "../helpers/pointers.js";
import { claimLatest } from "../observable/claim-latest.js";

export { TimelineModel, type TimelineOptions } from "./timeline.js";

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

// Single-event models route store updates by key, so each insert or remove reaches only its own models
const eventId = (event: StoreEvent) => event.id;
const kindAuthor = (event: StoreEvent) => event.kind + ":" + event.pubkey;
const byId = <E extends StoreEvent>(source: Observable<E>, id: string) =>
  getKeyedRouter(source, "id", eventId).route(id);
const byKindAuthor = <E extends StoreEvent>(source: Observable<E>, kind: number, pubkey: string) =>
  getKeyedRouter(source, "kind:pubkey", kindAuthor).route(kind + ":" + pubkey);

/** A model that returns a single event or undefined when its removed */
export function EventModel<E extends StoreEvent = NostrEvent>(pointer: string | EventPointer): Model<E | undefined, E> {
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
      byId(s.insert$, pointer.id),
      // emit undefined when deleted
      byId(s.remove$, pointer.id).pipe(
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
): Model<E | undefined, E> {
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
      byKindAuthor(s.insert$, pointer.kind, pointer.pubkey).pipe(
        filter((e) => (pointer.identifier !== undefined ? getReplaceableIdentifier(e) === pointer.identifier : true)),
      ),
    ).pipe(
      // Hacky way to extract the current event so it can be used in the remove$ stream
      tap((event) => (current = event)),
      // Subscribe to the event being removed
      mergeWith(
        byKindAuthor(s.remove$, pointer.kind, pointer.pubkey).pipe(
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

/** A model that streams all events that match the filters */
export function FiltersModel<E extends StoreEvent = NostrEvent>(
  filters: Filter | Filter[],
  onlyNew = false,
): Model<E, E> {
  filters = Array.isArray(filters) ? filters : [filters];

  return (store) => {
    // Bridge cast: see EventModel's comment above.
    const s = store as unknown as IEventStore<E> | IAsyncEventStore<E>;

    // Create the existing events observable
    const existingEvents$: Observable<E> = onlyNew ? EMPTY : defer(() => getByFiltersFromStores(s, filters));

    // Create the new events observable
    const newEvents$: Observable<E> = s.insert$.pipe(filter(compileFilters<E>(filters)));

    return merge(existingEvents$, newEvents$);
  };
}
