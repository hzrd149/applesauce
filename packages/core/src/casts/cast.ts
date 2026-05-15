import { EventModels, IEventStoreStreams, IEventSubscriptions } from "../event-store/index.js";
import { getParentEventStore, NostrEvent } from "../helpers/event.js";
import { EventCast } from "./event.js";

/** The type of event store that is passed to cast references */
export type CastRefEventStore = IEventSubscriptions & EventModels & IEventStoreStreams;

/** A symbol used to store all the cast instances for a given event */
export const CAST_REF_SYMBOL = Symbol.for("cast-ref");

/** A symbol used to store all the casts for an event */
export const CASTS_SYMBOL = Symbol.for("casts");

/** A class that can be used to cast a Nostr event */
export type CastConstructor<C extends EventCast<NostrEvent>> = new (event: NostrEvent, store: CastRefEventStore) => C;

/** Cast a Nostr event to a specific class */
export function castEvent<C extends EventCast<NostrEvent>>(
  event: NostrEvent,
  cls: CastConstructor<C>,
  store?: CastRefEventStore,
): C {
  const casts: Map<CastConstructor<C>, C> = Reflect.get(event, CASTS_SYMBOL);

  // If the event has already been cast to this class, return the existing cast
  const existing = casts?.get(cls);
  if (existing) return existing;

  if (!store) {
    store = getParentEventStore(event) as unknown as CastRefEventStore;
    if (!store) throw new Error("Event is not attached to an event store, an event store must be provided");
  }

  // Create a new instance of the class
  const cast = new cls(event, store);
  if (!casts) Reflect.set(event, CASTS_SYMBOL, new Map([[cls, cast]]));
  else casts.set(cls, cast);

  return cast;
}
