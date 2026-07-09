import { EventModels, IEventStoreStreams, IEventSubscriptions } from "../event-store/index.js";
import { getParentEventStore, NostrEvent, StoreEvent } from "../helpers/event.js";
import { EventCast } from "./event.js";

/** The type of event store that is passed to cast references */
export type CastRefEventStore<E extends StoreEvent = NostrEvent> = IEventSubscriptions<E> &
  EventModels<E> &
  IEventStoreStreams<E>;

/** A symbol used to store all the cast instances for a given event */
export const CAST_REF_SYMBOL = Symbol.for("cast-ref");

/** A symbol used to store all the casts for an event */
export const CASTS_SYMBOL = Symbol.for("casts");

// The constructor parameter stays `NostrEvent` (the narrow type) so existing signed-event cast
// constructors match exactly, while a rumor cast whose constructor accepts the wider `Rumor`
// (⊇ NostrEvent) stays contravariantly compatible. Only the constraint and `castEvent`'s input
// widen to `StoreEvent`, so a rumor can be cast even though the constructor is typed `NostrEvent`.

/** A class that can be used to cast a Nostr event (or an unsigned {@link StoreEvent}/rumor) */
export type CastConstructor<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent> = new (
  event: NostrEvent,
  store: CastRefEventStore<E>,
) => C;

/**
 * Gates {@link castEvent}'s accepted input type on whether a cast's own declared event type `T`
 * requires a signature. If `T` carries a `sig: string` field (a `NostrEvent`-shaped cast), the
 * input is pinned to `NostrEvent` — this rejects an unsigned rumor at compile time. Otherwise (a
 * rumor-shaped/sig-less `T`) the input stays a loose {@link StoreEvent} — deliberately not
 * narrowed to the cast's exact `T` (e.g. a literal `kind`), so a generic `Rumor` still satisfies
 * a narrowed-kind rumor cast; the cast's own constructor validates the narrower shape at runtime.
 */
export type CastEventInput<T extends StoreEvent> = T extends { sig: string } ? NostrEvent : StoreEvent;

/** @internal loose, runtime-guarded shared implementation — used by castEvent, castEventStream, and castTimelineStream */
export function performCast<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  event: StoreEvent,
  cls: CastConstructor<C, E>,
  store?: CastRefEventStore<E>,
): C {
  const casts: Map<CastConstructor<C, E>, C> = Reflect.get(event, CASTS_SYMBOL);

  // If the event has already been cast to this class, return the existing cast
  const existing = casts?.get(cls);
  if (existing) return existing;

  if (!store) {
    store = getParentEventStore(event) as unknown as CastRefEventStore<E>;
    if (!store) throw new Error("Event is not attached to an event store, an event store must be provided");
  }

  // Create a new instance of the class (the constructor reads only StoreEvent fields).
  const cast = new cls(event as NostrEvent, store);
  if (!casts) Reflect.set(event, CASTS_SYMBOL, new Map([[cls, cast]]));
  else casts.set(cls, cast);

  return cast;
}

/** Cast a Nostr event (or an unsigned StoreEvent/rumor) to a specific class */
export function castEvent<C extends EventCast<StoreEvent>, E extends StoreEvent = NostrEvent>(
  event: C extends EventCast<infer T> ? CastEventInput<T> : never,
  cls: CastConstructor<C, E>,
  store?: CastRefEventStore<E>,
): C {
  return performCast(event as StoreEvent, cls, store);
}
