import { castUser as coreCastUser, User } from "applesauce-core/casts";
import { kinds, nprofileEncode } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { combineLatest, defer, from, map, MonoTypeOperatorFunction, ReplaySubject, share, switchMap, tap } from "rxjs";
import { BLOSSOM_SERVER_LIST_KIND, getBlossomServersFromList } from "../helpers/blossom.js";
import { FAVORITE_EMOJI_PACKS_KIND } from "../helpers/emoji-pack.js";
import { GIT_GRASP_LIST_KIND } from "../helpers/git-grasp-list.js";
import { GIT_AUTHORS_KIND, FAVORITE_GIT_REPOS_KIND } from "../helpers/git-lists.js";
import { GROUPS_LIST_KIND } from "../helpers/groups.js";
import { getRelaysFromList } from "../helpers/lists.js";
import { FAVORITE_RELAYS_KIND, LOOKUP_RELAY_LIST_KIND } from "../helpers/relay-list.js";
import { TRUSTED_PROVIDER_LIST_KIND } from "../helpers/trusted-assertions.js";
import { castEventStream } from "../observable/cast-stream.js";
import { ChainableObservable } from "../observable/chainable.js";

// Re-export castUser and User from core so consumers don't need to change imports
export { castUser, User } from "applesauce-core/casts";

function memoize<T>(): MonoTypeOperatorFunction<T> {
  return share({
    connector: () => new ReplaySubject(1),
    resetOnRefCountZero: false,
    resetOnComplete: false,
  });
}

// IMPORTANT: this module MUST use async import() to import the other classes so that we do not get circular dependency errors
const Circular = defer(() => from(import("./_circular-import.js"))).pipe(memoize());

// ---------------------------------------------------------------------------
// Outbox cache — WeakMap so it's GC-safe and doesn't pollute User instances
// ---------------------------------------------------------------------------
const outboxCache = new WeakMap<User, string[] | undefined>();

// ---------------------------------------------------------------------------
// Prototype augmentation — attach Nostr-specific observable getters to User
// ---------------------------------------------------------------------------

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
  get(this: User): string {
    return nprofileEncode(this.pointer);
  },
  configurable: true,
  enumerable: false,
});

defineGetter("profile$", function (this: User) {
  return this.$$ref("profile$", (store) =>
    Circular.pipe(
      switchMap(({ Profile }) =>
        store.replaceable({ kind: kinds.Metadata, pubkey: this.pubkey }).pipe(castEventStream(Profile, store)),
      ),
    ),
  );
});

defineGetter("contacts$", function (this: User) {
  return this.$$ref("contacts$", (store) =>
    this.outboxes$.pipe(
      switchMap((outboxes) => store.contacts({ pubkey: this.pubkey, relays: outboxes })),
      map((arr: ProfilePointer[]) => arr.map((p) => coreCastUser(p, store))),
    ),
  );
});

defineGetter("mutes$", function (this: User) {
  return this.$$ref("mutes$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ Mutes }, outboxes]) =>
        store
          .event({ kind: kinds.Mutelist, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(Mutes, store)),
      ),
    ),
  );
});

defineGetter("mailboxes$", function (this: User) {
  return this.$$ref("mailboxes$", (store) =>
    store
      .mailboxes({ pubkey: this.pubkey })
      .pipe(tap((mailboxes: { outboxes: string[] } | undefined) => outboxCache.set(this, mailboxes?.outboxes))),
  );
});

defineGetter("outboxes$", function (this: User) {
  return this.mailboxes$.outboxes;
});

defineGetter("inboxes$", function (this: User) {
  return this.mailboxes$.inboxes;
});

defineGetter("bookmarks$", function (this: User) {
  return this.$$ref("bookmarks$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ BookmarksList }, outboxes]) =>
        store
          .replaceable({ kind: kinds.BookmarkList, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(BookmarksList, store)),
      ),
    ),
  );
});

defineGetter("favoriteRelays$", function (this: User) {
  return this.$$ref("favoriteRelays$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ FavoriteRelays }, outboxes]) =>
        store
          .replaceable({ kind: FAVORITE_RELAYS_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(FavoriteRelays, store)),
      ),
    ),
  );
});

defineGetter("favoriteEmojis$", function (this: User) {
  return this.$$ref("favoriteEmojis$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ FavoriteEmojis }, outboxes]) =>
        store
          .replaceable({ kind: FAVORITE_EMOJI_PACKS_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(FavoriteEmojis, store)),
      ),
    ),
  );
});

defineGetter("gitAuthors$", function (this: User) {
  return this.$$ref("gitAuthors$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ GitAuthors }, outboxes]) =>
        store
          .replaceable({ kind: GIT_AUTHORS_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(GitAuthors, store)),
      ),
    ),
  );
});

defineGetter("favoriteGitRepos$", function (this: User) {
  return this.$$ref("favoriteGitRepos", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ FavoriteGitRepos }, outboxes]) =>
        store
          .replaceable({ kind: FAVORITE_GIT_REPOS_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(FavoriteGitRepos, store)),
      ),
    ),
  );
});

defineGetter("graspServers$", function (this: User) {
  return this.$$ref("graspServers$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ GitGraspList }, outboxes]) =>
        store
          .replaceable({ kind: GIT_GRASP_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(GitGraspList, store)),
      ),
    ),
  );
});

defineGetter("searchRelays$", function (this: User) {
  return this.$$ref("searchRelays$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ SearchRelays }, outboxes]) =>
        store
          .replaceable({ kind: kinds.SearchRelaysList, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(SearchRelays, store)),
      ),
    ),
  );
});

defineGetter("lookupRelayList$", function (this: User) {
  return this.$$ref("lookupRelayList$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ LookupRelayList }, outboxes]) =>
        store
          .replaceable({ kind: LOOKUP_RELAY_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(LookupRelayList, store)),
      ),
    ),
  );
});

defineGetter("blockedRelays$", function (this: User) {
  return this.$$ref("blockedRelays$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ BlockedRelays }, outboxes]) =>
        store
          .replaceable({ kind: kinds.BlockedRelaysList, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(BlockedRelays, store)),
      ),
    ),
  );
});

defineGetter("directMessageRelays$", function (this: User) {
  return this.$$ref("dmRelays$", (store) =>
    this.outboxes$.pipe(
      switchMap((outboxes) =>
        store
          .replaceable({ kind: kinds.DirectMessageRelaysList, pubkey: this.pubkey, relays: outboxes })
          .pipe(map((event) => event && getRelaysFromList(event))),
      ),
    ),
  );
});

defineGetter("blossomServers$", function (this: User) {
  return this.$$ref("blossomServers$", (store) =>
    this.outboxes$.pipe(
      switchMap((outboxes) =>
        store
          .replaceable({ kind: BLOSSOM_SERVER_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(map((event) => event && getBlossomServersFromList(event))),
      ),
    ),
  );
});

defineGetter("groups$", function (this: User) {
  return this.$$ref("groups$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ GroupsList }, outboxes]) =>
        store
          .replaceable({ kind: GROUPS_LIST_KIND, pubkey: this.pubkey, relays: outboxes })
          .pipe(castEventStream(GroupsList, store)),
      ),
    ),
  );
});

defineGetter("trustedProviders$", function (this: User) {
  return this.$$ref("trustedProviders$", (store) =>
    combineLatest([Circular, this.outboxes$]).pipe(
      switchMap(([{ TrustedProviderList }, outboxes]) =>
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
    get favoriteEmojis$(): ChainableObservable<import("./favorite-emojis.js").FavoriteEmojis | undefined>;
    get favoriteRelays$(): ChainableObservable<import("./relay-lists.js").FavoriteRelays | undefined>;
    get gitAuthors$(): ChainableObservable<import("./git-lists.js").GitAuthors | undefined>;
    get favoriteGitRepos$(): ChainableObservable<import("./git-lists.js").FavoriteGitRepos | undefined>;
    get graspServers$(): ChainableObservable<import("./git-grasp-list.js").GitGraspList | undefined>;
    get searchRelays$(): ChainableObservable<import("./relay-lists.js").SearchRelays | undefined>;
    get lookupRelayList$(): ChainableObservable<import("./relay-lists.js").LookupRelayList | undefined>;
    get blockedRelays$(): ChainableObservable<import("./relay-lists.js").BlockedRelays | undefined>;
    get directMessageRelays$(): ChainableObservable<string[] | undefined>;
    get blossomServers$(): ChainableObservable<URL[] | undefined>;
    get groups$(): ChainableObservable<import("./groups.js").GroupsList | undefined>;
    get trustedProviders$(): ChainableObservable<import("./trusted-assertions.js").TrustedProviderList | undefined>;
  }
}
