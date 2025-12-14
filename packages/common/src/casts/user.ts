import {
  getParentEventStore,
  isEvent,
  isHexKey,
  kinds,
  NostrEvent,
  nprofileEncode,
  npubEncode,
} from "applesauce-core/helpers";
import { ProfilePointer } from "nostr-tools/nip19";
import { map, Observable, tap } from "rxjs";
import { MuteModel } from "../models/mutes.js";
import { castEventStream } from "../observable/cast-stream.js";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import { CastRefEventStore } from "./cast.js";
import { Mailboxes } from "./mailboxes.js";
import { Profile } from "./profile.js";

/** Cast a nostr event or pointer into a {@link User} */
export function castUser(event: NostrEvent): User;
export function castUser(user: string | ProfilePointer, store: CastRefEventStore): User;
export function castUser(user: string | ProfilePointer | NostrEvent, store?: CastRefEventStore): User {
  if (isEvent(user)) {
    if (!store) store = getParentEventStore(user) as unknown as CastRefEventStore;
    if (!store) throw new Error("Event is not attached to an event store");
    return castUser(user.pubkey, store);
  } else {
    if (!store) throw new Error("Store is required for casting a user");

    const pubkey = typeof user === "string" ? user : user.pubkey;

    // Skip creating a new instance if this pubkey has already been cast
    const existing = User.cache.get(pubkey);
    if (existing) return existing;

    // Create a new instance and cache it
    const newUser = new User(pubkey, store);
    User.cache.set(pubkey, newUser);
    return newUser;
  }
}

/** A class for a user */
export class User {
  public pubkey: string;

  #store: CastRefEventStore;

  /** A cache of the users outboxes for creating a profile pointer relay hints */
  #outboxes: string[] | undefined;

  /** A global cache of pubkey -> {@link User} */
  static cache = new Map<string, User>();

  constructor(user: string | ProfilePointer, store: CastRefEventStore) {
    if (typeof user === "string" && !isHexKey(user)) throw new Error("Invalid pubkey for user");
    const pubkey = typeof user === "string" ? user : user.pubkey;

    this.#store = store;
    this.pubkey = pubkey;
  }

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
    const observable = chainable(builder(this.#store));
    this.#refs[key] = observable;
    return observable;
  }

  // Public getters

  get npub() {
    return npubEncode(this.pubkey);
  }
  get pointer(): ProfilePointer {
    return {
      pubkey: this.pubkey,
      relays: this.#outboxes?.slice(0, 3) ?? [],
    };
  }
  get nprofile() {
    return nprofileEncode(this.pointer);
  }

  get profile$() {
    return this.$$ref("profile$", (store) =>
      store.replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEventStream(Profile)),
    );
  }
  get contacts$() {
    return this.$$ref("contacts$", (store) => store.contacts(this.pubkey)).pipe(
      map((arr) => arr.map((p) => castUser(p, this.#store))),
    );
  }
  get mutes$() {
    return this.$$ref("mutes$", (store) => store.model(MuteModel, this.pubkey));
  }
  get mailboxes$() {
    return this.$$ref("mailboxes$", (store) =>
      store.replaceable({ kind: kinds.RelayList, pubkey: this.pubkey }).pipe(
        castEventStream(Mailboxes),
        // Cache the outboxes for creating a profile pointer relay hints
        tap((mailboxes) => (this.#outboxes = mailboxes?.outboxes)),
      ),
    );
  }
  get outboxes$() {
    return this.mailboxes$.outboxes;
  }
  get inboxes$() {
    return this.mailboxes$.inboxes;
  }
}
