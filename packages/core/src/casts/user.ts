import { isEvent, NostrEvent } from "../helpers/event.js";
import { isHexKey } from "../helpers/string.js";
import { nprofileEncode, npubEncode, ProfilePointer } from "../helpers/pointers.js";
import { Observable } from "rxjs";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import type { CastRefEventStore } from "./cast.js";

/** Cast a Nostr event or pointer into a {@link BaseUser} */
export function castUser(event: NostrEvent, store: CastRefEventStore): BaseUser;
export function castUser(user: string | ProfilePointer, store: CastRefEventStore): BaseUser;
export function castUser(user: string | ProfilePointer | NostrEvent, store: CastRefEventStore): BaseUser {
  if (isEvent(user)) {
    return castUser(user.pubkey, store);
  } else {
    const pubkey = typeof user === "string" ? user : user.pubkey;

    // Skip creating a new instance if this pubkey has already been cast
    const existing = BaseUser.cache.get(pubkey);
    if (existing) return existing;

    // Create a new instance and cache it
    const newUser = new BaseUser(pubkey, store);
    BaseUser.cache.set(pubkey, newUser);
    return newUser;
  }
}

/** Minimal base class for a Nostr user — pubkey, pointer helpers, and store access */
export class BaseUser {
  public pubkey: string;

  #store: CastRefEventStore;

  /** A global cache of pubkey -> {@link BaseUser} */
  static cache = new Map<string, BaseUser>();

  constructor(user: string | ProfilePointer, store: CastRefEventStore) {
    if (typeof user === "string" && !isHexKey(user)) throw new Error("Invalid pubkey for user");
    const pubkey = typeof user === "string" ? user : user.pubkey;

    this.#store = store;
    this.pubkey = pubkey;
  }

  /** A cache of observable references */
  #refs: Record<string, ChainableObservable<unknown>> = {};

  /** Internal method for creating a cached observable reference */
  protected $$ref<Return extends unknown>(
    key: string,
    builder: (store: CastRefEventStore) => Observable<Return>,
  ): ChainableObservable<Return> {
    if (this.#refs[key]) return this.#refs[key] as ChainableObservable<Return>;
    const observable = chainable(builder(this.#store));
    this.#refs[key] = observable;
    return observable;
  }

  get store(): CastRefEventStore {
    return this.#store;
  }

  get npub() {
    return npubEncode(this.pubkey);
  }

  get pointer(): ProfilePointer {
    return { pubkey: this.pubkey };
  }

  get nprofile() {
    return nprofileEncode(this.pointer);
  }

  /** Subscribe to a replaceable event for this user */
  replaceable(kind: number, identifier?: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.#store.replaceable({ kind, pubkey: this.pubkey, identifier, relays }));
  }

  /** Subscribe to an addressable event for this user */
  addressable(kind: number, identifier: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.#store.addressable({ kind, pubkey: this.pubkey, identifier, relays }));
  }
}
