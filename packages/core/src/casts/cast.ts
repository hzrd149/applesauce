import { EventModels, IEventStoreStreams, IEventSubscriptions } from "../event-store/index.js";
import { getSeenRelays } from "../helpers/relays.js";
import { getEventUID, getParentEventStore, NostrEvent } from "../helpers/event.js";
import { isHexKey } from "../helpers/string.js";
import { Observable } from "rxjs";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import { castUser, User } from "./user.js";

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

/** The base class for all casts */
export class EventCast<T extends NostrEvent = NostrEvent> {
  get id() {
    return this.event.id;
  }
  get uid() {
    return getEventUID(this.event);
  }

  get createdAt() {
    return new Date(this.event.created_at * 1000);
  }

  /** Get the {@link User} that authored this event */
  get author(): User {
    return castUser(this.event, this.store);
  }

  /** Return the set of relays this event was seen on */
  get seen() {
    return getSeenRelays(this.event);
  }

  // Enfore kind check in constructor. this will force child classes to verify the event before calling super()
  constructor(
    readonly event: T,
    public readonly store: CastRefEventStore,
  ) {}

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

/** A constructor type for {@link PubkeyCast} subclasses */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PubkeyCastConstructor<C extends PubkeyCast> = (new (
  pubkey: string,
  store: CastRefEventStore,
  ...args: any[]
) => C) & {
  cache: Map<string, C>;
};

/**
 * Cast a pubkey to a specific class instance.
 * Works like {@link castUser} — returns a cached singleton per pubkey+args combination.
 */
export function castPubkey<C extends PubkeyCast>(
  pubkey: string,
  cls: PubkeyCastConstructor<C>,
  store: CastRefEventStore,
  ...args: unknown[]
): C {
  if (!isHexKey(pubkey)) throw new Error("Invalid pubkey");

  const cacheKey = args.length > 0 ? `${pubkey}:${JSON.stringify(args)}` : pubkey;

  if (!cls.cache) cls.cache = new Map();
  const existing = cls.cache.get(cacheKey);
  if (existing) return existing;

  const instance = new cls(pubkey, store, ...args);
  cls.cache.set(cacheKey, instance);
  return instance;
}

/** Base class for pubkey-based casts (analogous to {@link EventCast} for events) */
export class PubkeyCast {
  /** A global cache of cacheKey -> instance, populated by {@link castPubkey} */
  static cache: Map<string, PubkeyCast> = new Map();

  constructor(
    public readonly pubkey: string,
    public readonly store: CastRefEventStore,
  ) {}

  /** A cache of observable references */
  #refs: Record<string, ChainableObservable<unknown>> = {};

  /** Internal method for creating a cached observable reference */
  protected $$ref<Return extends unknown>(
    key: string,
    builder: (store: CastRefEventStore) => Observable<Return>,
  ): ChainableObservable<Return> {
    if (this.#refs[key]) return this.#refs[key] as ChainableObservable<Return>;
    const observable = chainable(builder(this.store));
    this.#refs[key] = observable;
    return observable;
  }
}
