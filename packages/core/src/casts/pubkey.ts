/** A constructor type for {@link PubkeyCast} subclasses */

import { Observable } from "rxjs";
import { isEvent, NostrEvent } from "../helpers/event.js";
import type { ProfilePointer } from "../helpers/pointers.js";
import { isHexKey } from "../helpers/string.js";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import { CastRefEventStore } from "./cast.js";

export type PubkeyCastConstructor<C extends PubkeyCast> = (new (
  pointer: ProfilePointer,
  store: CastRefEventStore,
) => C) & {
  cache: Map<string, C>;
};

/**
 * Cast a pubkey to a specific class instance.
 * Works like {@link castUser} - returns a cached singleton per pubkey+relay-hints combination.
 */
export function castPubkey<C extends PubkeyCast>(
  pubkey: string | NostrEvent | ProfilePointer,
  cls: PubkeyCastConstructor<C>,
  store: CastRefEventStore,
): C {
  if (isEvent(pubkey)) return castPubkey(pubkey.pubkey, cls, store);

  const pointer: ProfilePointer = typeof pubkey === "string" ? { pubkey } : pubkey;
  if (!isHexKey(pointer.pubkey)) throw new Error("Invalid pubkey");

  const cacheKey = pointer.relays?.length ? `${pointer.pubkey}:${JSON.stringify(pointer.relays)}` : pointer.pubkey;

  if (!cls.cache) cls.cache = new Map();
  const existing = cls.cache.get(cacheKey);
  if (existing) return existing;

  const instance = new cls(pointer, store);
  cls.cache.set(cacheKey, instance);
  return instance;
}

/** Base class for pubkey-based casts (analogous to {@link EventCast} for events) */
export class PubkeyCast {
  /** A global cache of pubkey -> instance, populated by {@link castPubkey} */
  static cache: Map<string, PubkeyCast> = new Map();

  constructor(
    public readonly pointer: ProfilePointer,
    public readonly store: CastRefEventStore,
  ) {}

  /** The hex pubkey represented by this cast */
  get pubkey(): string {
    return this.pointer.pubkey;
  }

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
