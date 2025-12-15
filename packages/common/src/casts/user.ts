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
import { defer, from, map, Observable, switchMap, tap } from "rxjs";
import { FAVORITE_RELAYS_KIND } from "../helpers/relay-list.js";
import { MuteModel } from "../models/mutes.js";
import { castEventStream } from "../observable/cast-stream.js";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import { type CastRefEventStore } from "./cast.js";

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

// IMPORTANT: this class MUST use async import() to import the other classes so that we do not get circular dependency errors

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
      defer(() => from(import("./profile.js").then((m) => m.Profile))).pipe(
        switchMap((Profile) =>
          store.replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEventStream(Profile)),
        ),
      ),
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
      defer(() => from(import("./mailboxes.js").then((m) => m.Mailboxes))).pipe(
        switchMap((Mailboxes) =>
          store.replaceable({ kind: kinds.RelayList, pubkey: this.pubkey }).pipe(
            castEventStream(Mailboxes),
            // Cache the outboxes for creating a profile pointer relay hints
            tap((mailboxes) => (this.#outboxes = mailboxes?.outboxes)),
          ),
        ),
      ),
    );
  }
  get outboxes$() {
    return this.mailboxes$.outboxes;
  }
  get inboxes$() {
    return this.mailboxes$.inboxes;
  }
  get bookmarksList$() {
    return this.$$ref("bookmarks$", (store) =>
      defer(() => from(import("./bookmarks.js").then((m) => m.BookmarksList))).pipe(
        switchMap((BookmarksList) =>
          store.replaceable({ kind: kinds.BookmarkList, pubkey: this.pubkey }).pipe(castEventStream(BookmarksList)),
        ),
      ),
    );
  }

  get favoriteRelays$() {
    return this.$$ref("favoriteRelays$", (store) =>
      defer(() => from(import("./relay-lists.js").then((m) => m.FavoriteRelays))).pipe(
        switchMap((FavoriteRelaysList) =>
          store
            .replaceable({ kind: FAVORITE_RELAYS_KIND, pubkey: this.pubkey })
            .pipe(castEventStream(FavoriteRelaysList)),
        ),
      ),
    );
  }
  get searchRelays$() {
    return this.$$ref("searchRelays$", (store) =>
      defer(() => from(import("./relay-lists.js").then((m) => m.SearchRelays))).pipe(
        switchMap((SearchRelaysList) =>
          store
            .replaceable({ kind: kinds.SearchRelaysList, pubkey: this.pubkey })
            .pipe(castEventStream(SearchRelaysList)),
        ),
      ),
    );
  }
  get blockedRelays$() {
    return this.$$ref("blockedRelays$", (store) =>
      defer(() => from(import("./relay-lists.js").then((m) => m.BlockedRelays))).pipe(
        switchMap((BlockedRelaysList) =>
          store
            .replaceable({ kind: kinds.BlockedRelaysList, pubkey: this.pubkey })
            .pipe(castEventStream(BlockedRelaysList)),
        ),
      ),
    );
  }

  /** Get the latest live stream for the user */
  get live$() {
    return this.$$ref("live$", (store) =>
      defer(() => import("./stream.js").then((m) => m.Stream)).pipe(
        switchMap((Stream) =>
          store
            .timeline([
              { kinds: [kinds.LiveEvent], "#p": [this.pubkey] },
              { kinds: [kinds.LiveEvent], authors: [this.pubkey] },
            ])
            .pipe(
              map((events) => events[0] as NostrEvent | undefined),
              castEventStream(Stream),
            ),
        ),
      ),
    );
  }
}
