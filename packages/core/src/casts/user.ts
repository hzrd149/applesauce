import { NostrEvent } from "../helpers/event.js";
import { nprofileEncode, npubEncode, ProfilePointer } from "../helpers/pointers.js";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import type { CastRefEventStore } from "./cast.js";
import { castPubkey, PubkeyCast } from "./pubkey.js";

/** Cast a Nostr event or pointer into a {@link User} */
export function castUser(event: NostrEvent, store: CastRefEventStore): User;
export function castUser(user: string | ProfilePointer, store: CastRefEventStore): User;
export function castUser(user: string | ProfilePointer | NostrEvent, store: CastRefEventStore): User {
  return castPubkey(user, User, store);
}

/** A class representing a Nostr user */
export class User extends PubkeyCast {
  /** A global cache of pubkey -> {@link User} */
  static cache = new Map<string, User>();

  get npub() {
    return npubEncode(this.pubkey);
  }

  get nprofile() {
    return nprofileEncode(this.pointer);
  }

  /** Subscribe to a replaceable event for this user */
  replaceable(kind: number, identifier?: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.store.replaceable({ kind, pubkey: this.pointer.pubkey, identifier, relays }));
  }

  /** Subscribe to an addressable event for this user */
  addressable(kind: number, identifier: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.store.addressable({ kind, pubkey: this.pointer.pubkey, identifier, relays }));
  }
}
