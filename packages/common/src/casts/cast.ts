import { EventModels, IEventStoreStreams, IEventSubscriptions } from "applesauce-core/event-store";
import { getSeenRelays } from "applesauce-core/helpers";
import { getParentEventStore, NostrEvent } from "applesauce-core/helpers/event";
import { Observable } from "rxjs";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import { castUser } from "./user.js";

/** The type of event store that is passed to cast references */
export type CastRefEventStore = IEventSubscriptions & EventModels & IEventStoreStreams;

/** A symbol used to store all the cast instances for a given event */
export const CAST_REF_SYMBOL = Symbol.for("cast-ref");

/** A symbol used to store all the casts for an event */
export const CASTS_SYMBOL = Symbol.for("casts");

/** A class that can be used to cast a Nostr event */
export type CastConstructor<C extends EventCast<NostrEvent>> = new (event: NostrEvent) => C;

/** Cast a Nostr event to a specific class */
export function castEvent<C extends EventCast<NostrEvent>>(event: NostrEvent, cls: CastConstructor<C>): C {
  const casts: Map<CastConstructor<C>, C> = Reflect.get(event, CASTS_SYMBOL);

  // If the event has already been cast to this class, return the existing cast
  const existing = casts?.get(cls);
  if (existing) return existing;

  // Create a new instance of the class
  const cast = new cls(event);
  if (!casts) Reflect.set(event, CASTS_SYMBOL, new Map([[cls, cast]]));
  else casts.set(cls, cast);

  return cast;
}

/** The base class for all casts */
export class EventCast<T extends NostrEvent = NostrEvent> {
  get id() {
    return this.event.id;
  }
  get pubkey() {
    return this.event.pubkey;
  }
  get kind() {
    return this.event.kind;
  }
  get tags() {
    return this.event.tags;
  }
  get content() {
    return this.event.content;
  }
  get created_at() {
    return this.event.created_at;
  }
  get sig() {
    return this.event.sig;
  }

  /** Gets the event store for this event cast */
  get store() {
    const store = getParentEventStore(this.event);
    if (!store) throw new Error("Event is not attached to an event store");
    return store as unknown as CastRefEventStore;
  }

  /** Get the {@link User} that authored this event */
  get author() {
    return castUser(this.event);
  }

  /** Return the set of relays this event was seen on */
  get seen() {
    return getSeenRelays(this.event);
  }

  // Enfore kind check in constructor. this will force child classes to verify the event before calling super()
  constructor(readonly event: T) {}

  /** A cache of observable references */
  #refs: Record<string, ChainableObservable<unknown>> = {};

  /** Internal method for creating a reference */
  protected $$ref<Return extends unknown>(
    key: string,
    builder: (store: CastRefEventStore) => Observable<Return>,
  ): ChainableObservable<Return> {
    // Return cached observable
    if (this.#refs[key]) return this.#refs[key] as ChainableObservable<Return>;

    // Build a new observable and cache it
    const observable = chainable(builder(this.store));
    this.#refs[key] = observable;
    return observable;
  }
}
