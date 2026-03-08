import { kinds, NostrEvent, nprofileEncode } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { User, castUser as coreCastUser } from "applesauce-core/casts";
import { combineLatest, defer, from, map, MonoTypeOperatorFunction, ReplaySubject, share, switchMap, tap } from "rxjs";
import { BLOSSOM_SERVER_LIST_KIND, getBlossomServersFromList } from "../helpers/blossom.js";
import { GROUPS_LIST_KIND } from "../helpers/groups.js";
import { getRelaysFromList } from "../helpers/lists.js";
import { FAVORITE_RELAYS_KIND } from "../helpers/relay-list.js";
import { TRUSTED_PROVIDER_LIST_KIND } from "../helpers/trusted-assertions.js";
import { castEventStream } from "../observable/cast-stream.js";
import { ChainableObservable } from "../observable/chainable.js";

// Re-export castUser and User from core so consumers don't need to change imports
export { castUser } from "applesauce-core/casts";
export { User } from "applesauce-core/casts";

function memoize<T>(): MonoTypeOperatorFunction<T> {
  return share({
    connector: () => new ReplaySubject(1),
    resetOnRefCountZero: false,
    resetOnComplete: false,
  });
}

// IMPORTANT: this module MUST use async import() to import the other classes so that we do not get circular dependency errors
const Circular = {
  Profile: defer(() => from(import("./profile.js"))).pipe(memoize()),
  Mutes: defer(() => from(import("./mutes.js"))).pipe(memoize()),
  Bookmarks: defer(() => from(import("./bookmarks.js"))).pipe(memoize()),
  RelayLists: defer(() => from(import("./relay-lists.js"))).pipe(memoize()),
  Groups: defer(() => from(import("./groups.js"))).pipe(memoize()),
  TrustedAssertions: defer(() => from(import("./trusted-assertions.js"))).pipe(memoize()),
};

// ---------------------------------------------------------------------------
// Outbox cache — WeakMap so it's GC-safe and doesn't pollute User instances
// ---------------------------------------------------------------------------
const outboxCache = new WeakMap<User, string[] | undefined>();

// ---------------------------------------------------------------------------
// Prototype augmentation — attach Nostr-specific observable getters to User
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defineGetter(name: string, fn: (this: User) => any) {
  Object.defineProperty(User.prototype, name, {
    get: fn,
    configurable: true,
    enumerable: false,
  });
}

// Override pointer to include relay hints from outboxes
Object.defineProperty(User.prototype, "pointer", {
  get(this: User): ProfilePointer {
    return { pubkey: this.pubkey, relays: outboxCache.get(this)?.slice(0, 3) ?? [] };
  },
  configurable: true,
  enumerable: false,
});

// Override nprofile to use the enriched pointer
Object.defineProperty(User.prototype, "nprofile", {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(this: User): string {
    return nprofileEncode((this as any).pointer);
  },
  configurable: true,
  enumerable: false,
});

defineGetter("profile$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("profile$", (store: any) =>
    Circular.Profile.pipe(
      switchMap(({ Profile }) =>
        store.replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEventStream(Profile, store)),
      ),
    ),
  );
});

defineGetter("contacts$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("contacts$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).outboxes$.pipe(
      switchMap((outboxes: string[] | undefined) => store.contacts({ pubkey: this.pubkey, relays: outboxes })),
      map((arr: ProfilePointer[]) => arr.map((p) => coreCastUser(p, store))),
    ),
  );
});

defineGetter("mutes$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("mutes$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combineLatest([Circular.Mutes, (this as any).outboxes$]).pipe(
      switchMap(([{ Mutes }, outboxes]: any[]) =>
        store
          .event({ kind: kinds.Mutelist, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(Mutes, store)),
      ),
    ),
  );
});

defineGetter("mailboxes$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("mailboxes$", (store: any) =>
    store
      .mailboxes({ pubkey: this.pubkey })
      .pipe(tap((mailboxes: { outboxes: string[] } | undefined) => outboxCache.set(this, mailboxes?.outboxes))),
  );
});

defineGetter("outboxes$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).mailboxes$.outboxes;
});

defineGetter("inboxes$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).mailboxes$.inboxes;
});

defineGetter("bookmarks$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("bookmarks$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combineLatest([Circular.Bookmarks, (this as any).outboxes$]).pipe(
      switchMap(([{ BookmarksList }, outboxes]: any[]) =>
        store
          .replaceable({ kind: kinds.BookmarkList, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(BookmarksList, store)),
      ),
    ),
  );
});

defineGetter("favoriteRelays$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("favoriteRelays$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combineLatest([Circular.RelayLists, (this as any).outboxes$]).pipe(
      switchMap(([{ FavoriteRelays }, outboxes]: any[]) =>
        store
          .replaceable({ kind: FAVORITE_RELAYS_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(FavoriteRelays, store)),
      ),
    ),
  );
});

defineGetter("searchRelays$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("searchRelays$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combineLatest([Circular.RelayLists, (this as any).outboxes$]).pipe(
      switchMap(([{ SearchRelays }, outboxes]: any[]) =>
        store
          .replaceable({ kind: kinds.SearchRelaysList, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(SearchRelays, store)),
      ),
    ),
  );
});

defineGetter("blockedRelays$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("blockedRelays$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combineLatest([Circular.RelayLists, (this as any).outboxes$]).pipe(
      switchMap(([{ BlockedRelays }, outboxes]: any[]) =>
        store
          .replaceable({ kind: kinds.BlockedRelaysList, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(BlockedRelays, store)),
      ),
    ),
  );
});

defineGetter("directMessageRelays$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("dmRelays$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).outboxes$.pipe(
      switchMap((outboxes: string[] | undefined) =>
        store
          .replaceable({ kind: kinds.DirectMessageRelaysList, pubkey: this.pubkey, relays: outboxes })
          .pipe(map((event: NostrEvent | undefined) => event && getRelaysFromList(event))),
      ),
    ),
  );
});

defineGetter("blossomServers$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("blossomServers$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any).outboxes$.pipe(
      switchMap((outboxes: string[] | undefined) =>
        store
          .replaceable({ kind: BLOSSOM_SERVER_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(map((event: NostrEvent | undefined) => event && getBlossomServersFromList(event))),
      ),
    ),
  );
});

defineGetter("groups$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("groups$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combineLatest([Circular.Groups, (this as any).outboxes$]).pipe(
      switchMap(([{ GroupsList }, outboxes]: any[]) =>
        store
          .replaceable({ kind: GROUPS_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(GroupsList, store)),
      ),
    ),
  );
});

defineGetter("live$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("live$", (store: any) =>
    defer(() => import("./stream.js").then((m) => m.Stream)).pipe(
      switchMap((Stream) =>
        store
          .timeline([
            { kinds: [kinds.LiveEvent], "#p": [this.pubkey] },
            { kinds: [kinds.LiveEvent], authors: [this.pubkey] },
          ])
          .pipe(
            map((events: NostrEvent[]) => events[0] as NostrEvent | undefined),
            castEventStream(Stream, store),
          ),
      ),
    ),
  );
});

defineGetter("trustedProviders$", function (this: User) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (this as any).$$ref("trustedProviders$", (store: any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    combineLatest([Circular.TrustedAssertions, (this as any).outboxes$]).pipe(
      switchMap(([{ TrustedProviderList }, outboxes]: any[]) =>
        store
          .replaceable({ kind: TRUSTED_PROVIDER_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(TrustedProviderList, store)),
      ),
    ),
  );
});

// ---------------------------------------------------------------------------
// TypeScript interface merging — declare the added properties on User
// ---------------------------------------------------------------------------
declare module "applesauce-core/casts" {
  interface User {
    get profile$(): ChainableObservable<import("./profile.js").Profile | undefined>;
    get contacts$(): ChainableObservable<User[]>;
    get mutes$(): ChainableObservable<import("./mutes.js").Mutes | undefined>;
    get mailboxes$(): ChainableObservable<{ inboxes: string[]; outboxes: string[] } | undefined>;
    get outboxes$(): ChainableObservable<string[] | undefined>;
    get inboxes$(): ChainableObservable<string[] | undefined>;
    get bookmarks$(): ChainableObservable<import("./bookmarks.js").BookmarksList | undefined>;
    get favoriteRelays$(): ChainableObservable<import("./relay-lists.js").FavoriteRelays | undefined>;
    get searchRelays$(): ChainableObservable<import("./relay-lists.js").SearchRelays | undefined>;
    get blockedRelays$(): ChainableObservable<import("./relay-lists.js").BlockedRelays | undefined>;
    get directMessageRelays$(): ChainableObservable<string[] | undefined>;
    get blossomServers$(): ChainableObservable<string[] | undefined>;
    get groups$(): ChainableObservable<import("./groups.js").GroupsList | undefined>;
    get live$(): ChainableObservable<import("./stream.js").Stream | undefined>;
    get trustedProviders$(): ChainableObservable<import("./trusted-assertions.js").TrustedProviderList | undefined>;
  }
}
