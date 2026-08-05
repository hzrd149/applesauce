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
  cache?: Map<string, WeakRef<C>>;
  cacheRegistry?: FinalizationRegistry<string>;
};

const storeCacheIds = new WeakMap<CastRefEventStore, number>();
let nextStoreCacheId = 0;

function getStoreCacheId(store: CastRefEventStore): number {
  let id = storeCacheIds.get(store);
  if (id === undefined) {
    id = ++nextStoreCacheId;
    storeCacheIds.set(store, id);
  }
  return id;
}

/**
 * Cast a pubkey to a specific class instance.
 * Works like {@link castUser} - returns a cached singleton per pubkey+relay-hints combination.
 *
 * @note Instances are held weakly so unused casts can be garbage collected instead of
 * accumulating one instance per pubkey for the lifetime of the process.
 */
export function castPubkey<C extends PubkeyCast>(
  pubkey: string | NostrEvent | ProfilePointer,
  cls: PubkeyCastConstructor<C>,
  store: CastRefEventStore,
): C {
  if (isEvent(pubkey)) return castPubkey(pubkey.pubkey, cls, store);

  const pointer: ProfilePointer = typeof pubkey === "string" ? { pubkey } : pubkey;
  if (!isHexKey(pointer.pubkey)) throw new Error("Invalid pubkey");

  const pointerKey = pointer.relays?.length ? `${pointer.pubkey}:${JSON.stringify(pointer.relays)}` : pointer.pubkey;
  const cacheKey = `${getStoreCacheId(store)}:${pointerKey}`;

  if (!cls.cache) cls.cache = new Map();
  // Clean up dead cache entries when their instances are garbage collected
  if (!cls.cacheRegistry)
    cls.cacheRegistry = new FinalizationRegistry((key) => {
      // Only drop the entry if it still points at a collected instance; a re-created
      // instance under the same key has a live ref and must be kept.
      if (cls.cache!.get(key)?.deref() === undefined) cls.cache!.delete(key);
    });

  const existing = cls.cache.get(cacheKey)?.deref();
  if (existing) return existing;

  const instance = new cls(pointer, store);
  cls.cache.set(cacheKey, new WeakRef(instance));
  cls.cacheRegistry.register(instance, cacheKey);
  return instance;
}

/** Base class for pubkey-based casts (analogous to {@link EventCast} for events) */
export class PubkeyCast {
  /** A global cache of pubkey -> weak instance reference, populated by {@link castPubkey} */
  static cache: Map<string, WeakRef<PubkeyCast>> = new Map();
  /** Cleans up dead {@link cache} entries when their instances are garbage collected */
  static cacheRegistry?: FinalizationRegistry<string>;

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
