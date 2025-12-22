import {
  isEvent,
  isHexKey,
  kinds,
  NostrEvent,
  nprofileEncode,
  npubEncode,
  ProfilePointer,
} from "applesauce-core/helpers";
import { combineLatest, defer, from, map, Observable, switchMap, tap } from "rxjs";
import { GROUPS_LIST_KIND } from "../helpers/groups.js";
import { getRelaysFromList } from "../helpers/lists.js";
import { FAVORITE_RELAYS_KIND } from "../helpers/relay-list.js";
import { castEventStream } from "../observable/cast-stream.js";
import { chainable, ChainableObservable } from "../observable/chainable.js";
import { type CastRefEventStore } from "./cast.js";

/** Cast a nostr event or pointer into a {@link User} */
export function castUser(event: NostrEvent, store: CastRefEventStore): User;
export function castUser(user: string | ProfilePointer, store: CastRefEventStore): User;
export function castUser(user: string | ProfilePointer | NostrEvent, store: CastRefEventStore): User {
  if (isEvent(user)) {
    return castUser(user.pubkey, store);
  } else {
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

  // Request methods
  replaceable(kind: number, identifier?: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.#store.replaceable({ kind, pubkey: this.pubkey, identifier, relays }));
  }
  addressable(kind: number, identifier: string, relays?: string[]): ChainableObservable<NostrEvent | undefined> {
    return chainable(this.#store.addressable({ kind, pubkey: this.pubkey, identifier, relays }));
  }

  // Observable interfaces
  get profile$() {
    return this.$$ref("profile$", (store) =>
      defer(() => from(import("./profile.js").then((m) => m.Profile))).pipe(
        switchMap((Profile) =>
          store.replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEventStream(Profile, store)),
        ),
      ),
    );
  }
  get contacts$() {
    return this.$$ref("contacts$", (store) =>
      this.outboxes$.pipe(
        // Fetch the contacts from the outboxes
        switchMap((outboxes) => store.contacts({ pubkey: this.pubkey, relays: outboxes })),
        // Cast to users
        map((arr) => arr.map((p) => castUser(p, this.#store))),
      ),
    );
  }
  get mutes$() {
    return this.$$ref("mutes$", (store) =>
      combineLatest([
        // Import the Mutes class
        defer(() => import("./mutes.js").then((m) => m.Mutes)),
        // Always start without the outboxes
        this.outboxes$,
      ]).pipe(
        // Create the mute list event with the outboxes
        switchMap(([Mutes, outboxes]) =>
          store
            .event({ kind: kinds.Mutelist, pubkey: this.pubkey, relays: outboxes })
            .pipe(castEventStream(Mutes, store)),
        ),
      ),
    );
  }
  get mailboxes$() {
    return this.$$ref("mailboxes$", (store) =>
      store.mailboxes({ pubkey: this.pubkey }).pipe(
        // Cache the outboxes for creating a profile pointer relay hints
        tap((mailboxes) => (this.#outboxes = mailboxes?.outboxes)),
      ),
    );
  }
  get outboxes$(): ChainableObservable<string[] | undefined> {
    return this.mailboxes$.outboxes;
  }
  get inboxes$(): ChainableObservable<string[] | undefined> {
    return this.mailboxes$.inboxes;
  }
  get bookmarks$() {
    return this.$$ref("bookmarks$", (store) =>
      combineLatest([
        // Import the BookmarksList class
        defer(() => from(import("./bookmarks.js").then((m) => m.BookmarksList))),
        // Get outboxes and start without them
        this.outboxes$,
      ]).pipe(
        switchMap(([BookmarksList, outboxes]) =>
          // Fetch the bookmarks list event from the outboxes
          store
            .replaceable({ kind: kinds.BookmarkList, pubkey: this.pubkey, relays: outboxes })
            .pipe(castEventStream(BookmarksList, store)),
        ),
      ),
    );
  }
  get favoriteRelays$() {
    return this.$$ref("favoriteRelays$", (store) =>
      combineLatest([
        // Import the FavoriteRelays class
        defer(() => from(import("./relay-lists.js").then((m) => m.FavoriteRelays))),
        // Get outboxes and start without them
        this.outboxes$,
      ]).pipe(
        // Fetch the favorite relays list event from the outboxes
        switchMap(([FavoriteRelaysList, outboxes]) =>
          store
            .replaceable({ kind: FAVORITE_RELAYS_KIND, pubkey: this.pubkey, relays: outboxes })
            .pipe(castEventStream(FavoriteRelaysList, store)),
        ),
      ),
    );
  }
  get searchRelays$() {
    return this.$$ref("searchRelays$", (store) =>
      combineLatest([
        // Import the SearchRelays class
        defer(() => from(import("./relay-lists.js").then((m) => m.SearchRelays))),
        // Get outboxes and start without them
        this.outboxes$,
      ]).pipe(
        // Fetch the search relays list event from the outboxes
        switchMap(([SearchRelaysList, outboxes]) =>
          store
            .replaceable({ kind: kinds.SearchRelaysList, pubkey: this.pubkey, relays: outboxes })
            .pipe(castEventStream(SearchRelaysList, store)),
        ),
      ),
    );
  }
  get blockedRelays$() {
    return this.$$ref("blockedRelays$", (store) =>
      combineLatest([
        // Import the BlockedRelays class
        defer(() => from(import("./relay-lists.js").then((m) => m.BlockedRelays))),
        // Get outboxes and start without them
        this.outboxes$,
      ]).pipe(
        // Fetch the blocked relays list event from the outboxes
        switchMap(([BlockedRelaysList, outboxes]) =>
          store
            .replaceable({ kind: kinds.BlockedRelaysList, pubkey: this.pubkey, relays: outboxes })
            .pipe(castEventStream(BlockedRelaysList, store)),
        ),
      ),
    );
  }
  get directMessageRelays$() {
    return this.$$ref("dmRelays$", (store) =>
      this.outboxes$.pipe(
        // Fetch the DM relays list event from the outboxes
        switchMap((outboxes) =>
          store
            .replaceable({ kind: kinds.DirectMessageRelaysList, pubkey: this.pubkey, relays: outboxes })
            .pipe(map((event) => event && getRelaysFromList(event))),
        ),
      ),
    );
  }

  /** Gets the users list of NIP-29 groups */
  get groups$() {
    return this.$$ref("groups$", (store) =>
      combineLatest([
        // Import the BlockedRelays class
        defer(() => from(import("./groups.js").then((m) => m.GroupsList))),
        // Get outboxes and start without them
        this.outboxes$,
      ]).pipe(
        switchMap(([GroupsList, outboxes]) =>
          store
            .replaceable({ kind: GROUPS_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
            .pipe(castEventStream(GroupsList, store)),
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
              castEventStream(Stream, store),
            ),
        ),
      ),
    );
  }
}
