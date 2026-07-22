// ConcordClient — the thin multi-community manager.
//
// Owns the per-user Community List (kind 13302), the shared RelayPool / NIP-42
// authenticator / wrap-level EventStore, and a Map of single-community
// `ConcordCommunity` engines. It carries no community logic itself: joining,
// syncing, folding, and publishing all live in `ConcordCommunity`. One instance
// per logged-in user.

import {
  BehaviorSubject,
  Observable,
  Subscription,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  lastValueFrom,
  map,
  of,
  shareReplay,
  switchMap,
  timeout,
  toArray,
} from "rxjs";
import type { Debugger } from "debug";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { castUser, type User } from "applesauce-core/casts";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { getReplaceableIdentifier, setHiddenContentCache } from "applesauce-core/helpers";
import { unixNow } from "applesauce-core/helpers/time";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";

import { logger } from "../logger.js";
import { ConcordRelayAuth } from "./relay-auth.js";
import { defaultStorage, type ConcordStorage, type ConcordStoreFactory, type ConcordUploader } from "./storage.js";
// Side-effect import: registers the `User.concord*List$` getters used below (the named
// imports are type-only, so without this bare import the registration would be elided).
import "../casts/index.js";
import type { ConcordCommunityList, ConcordInviteList } from "../casts/index.js";
import { createCommunity } from "../helpers/community.js";
import {
  COMMUNITY_LIST_KIND,
  canonicalJson,
  communityListWithinByteCap,
  liveCommunities,
  mergeCommunities,
  mergeCommunityTombstones,
  parseCommunityList,
} from "../helpers/community-list.js";
import {
  INVITE_BUNDLE_KIND,
  STOCK_RELAYS,
  getInviteBundle,
  isInviteBundleRevoked,
  isValidInviteBundle,
  parseInviteLink,
  validateInviteBundle,
} from "../helpers/invite-bundle.js";
import { ExtraRelays, type ExtraRelaysOption } from "../helpers/relays.js";
import { joinCommunity, leaveCommunity, refreshCommunity } from "../operations/community-list.js";
import { JoinLeaveFactory } from "../factories/guestbook.js";
import { InviteWatcher } from "./invite-watcher.js";
import type { ConcordDirectInvite } from "../casts/direct-invite.js";
import { ConcordInviteManager } from "./invite-manager.js";
import type {
  CommunityListCommunity,
  CommunityState,
  CommunityTombstone,
  ConcordClientStatus,
  ConcordCommunityStatus,
  InviteBundle,
  JoinMaterial,
} from "../types.js";
import { ConcordCommunity } from "./community.js";

/** Debounce window for the opt-in post-sync community-list flush, so a burst of
 *  epoch adoptions (each community catching up as its walk finishes) collapses into
 *  a single {@link ConcordClient.saveCommunityList} call. */
const COMMUNITY_LIST_FLUSH_DEBOUNCE_MS = 200;

/**
 * Collapse a multi-relay union of events at one addressable coordinate to its
 * single NIP-01 winner (newest `created_at`, tie -> lowest `id`) — replicated
 * verbatim from `EventStore`'s replaceable-history winner selection
 * (`event-store.ts:264-267`) since no store exists pre-join (INVITE-01/D-03).
 * MUST run BEFORE any liveness/revocation check: a tombstone is exactly as
 * durable as the bundle it replaced (CORD-05 §2) and must compete for
 * "newest" on equal footing, never be pre-excluded (D-01).
 */
function newestAtCoordinate(events: NostrEvent[]): NostrEvent | undefined {
  let winner: NostrEvent | undefined;
  for (const e of events) {
    if (!winner || e.created_at > winner.created_at || (e.created_at === winner.created_at && e.id < winner.id))
      winner = e;
  }
  return winner;
}

/**
 * Does `event` actually sit at the invite coordinate `(33301, linkSigner, "")`?
 * INVITE-01/D-02: the outgoing `pool.request` filter (`authors`, `#d`) is a
 * REQUEST to relays, not a guarantee — `mapEventsToTimeline` unions whatever
 * every queried relay returns and never re-checks it against the filter. So a
 * single misbehaving/compromised relay could otherwise inject a kind-33301
 * event with an arbitrary author or non-empty `d` tag, win the `created_at`
 * race in {@link newestAtCoordinate}, and be treated as "the" coordinate's
 * winner (denying an otherwise-valid join, or shadowing the real newest event).
 * Enforce the coordinate constraints on the INBOUND events, never trusting the
 * relay set to have honored the filter.
 */
function isAtCoordinate(event: NostrEvent, linkSigner: string): boolean {
  return event.pubkey === linkSigner && getReplaceableIdentifier(event) === "";
}

/** Options for constructing the multi-community {@link ConcordClient} manager. */
export interface ConcordClientOptions {
  /** The logged-in user's signer. */
  signer: ISigner;
  /** The applesauce RelayPool used for all subscriptions/publishes. */
  pool: RelayPool;
  /** Shared wrap-level store. Defaults to a fresh {@link EventStore}. */
  eventStore?: EventStore;
  /** Persistence for the membership/key material mirror + sync cursors. */
  storage?: ConcordStorage;
  /** Media uploader, passed through to every community. */
  uploader?: ConcordUploader;
  /** Fallback relays when a community defines none. */
  relays?: string[];
  /**
   * Additional relay endpoints used purely as network targets for all Concord-managed
   * traffic: community and channel sync, live subscriptions, publishes, community-list and
   * invite-list reads and writes, direct-invite watching, invite-bundle fetch/publish/revoke,
   * and relay auth (D-12).
   *
   * These extras are NEVER written into community material or metadata, invite bundles,
   * invite links, or the user's published lists, and they never appear in the community's
   * protocol state — a link generated by an app using a local cache relay opens for someone
   * who has never heard of it (D-01).
   *
   * Additive only: extras never suppress or substitute for anything, and the existing
   * material-then-options-then-stock fallback chain (see {@link relays} above) is untouched.
   * An app wanting local-only traffic should set that fallback `relays` option instead, not
   * this one. With no extras configured, {@link ExtraRelays.merge}'s identity fast path returns
   * the base relay set completely unchanged (D-14); when extras ARE configured, the merged
   * transport set is normalized and deduplicated (`mergeRelaySets`), which changes the shape of
   * relay-target strings and `pool.status$` lookup keys for that configuration.
   *
   * Accepts a static array or an `Observable<string[]>`. A not-yet-emitted source resolves to
   * the empty set and never blocks traffic; later emissions take effect for future traffic and
   * for live sockets. Because each engine (this client, every community, the invite manager,
   * and the invite watcher) subscribes its own source, pass a hot/shared source — e.g. a
   * `BehaviorSubject` or a `shareReplay(1)`-wrapped Observable — if they should all react to
   * the same live extras stream (D-10).
   *
   * Two status consequences follow from widening transport targets (D-07 — see
   * {@link ConcordCommunity.connected$} / {@link ConcordCommunity.authenticated$}): an
   * always-up local relay can keep a community's `connected$` high even while every one of its
   * real community relays is down, and an extra that gates and rejects our stream keys can
   * hold `authenticated$` low.
   *
   * To release every engine's subscription to this source (so the app's Observable has no
   * remaining Concord subscriber), call {@link ConcordClient.dispose} — {@link ConcordClient.stop}
   * is pause-only and deliberately keeps these subscriptions alive so the client stays reactive
   * across a stop/start cycle.
   */
  extraRelays?: ExtraRelaysOption;
  /** Per-plane store factory (persistent cache), passed through to every community. */
  storeFactory?: ConcordStoreFactory;
  /** Automatically decrypt (unlock) the user's self-encrypted events with their signer: the
   *  Community/Invite lists (kind 13302/13303) as they arrive, and incoming Direct Invites.
   *  Defaults to `false` so the signer isn't invoked without intent — the app unlocks on demand
   *  (`.unlock(signer)` on the exposed cast, {@link InviteWatcher.readPending}). Community-plane
   *  decryptions (derived group keys, no prompt) always happen automatically regardless. */
  autoUnlock?: boolean;
  /** Automatically NIP-42-authenticate as the user on the Direct Invite inbox relays when they
   *  challenge. Defaults to `false` — the app authenticates on demand via
   *  {@link InviteWatcher.authenticateUser} (watch {@link InviteWatcher.needsAuth$}). */
  autoAuthenticate?: boolean;
  /** Automatically publish an updated kind 13302 after a sync when the community list has
   *  changed locally (an epoch caught up, a refounding removal). Defaults to `false` so the
   *  initial sync has **zero** side effects — no signer calls, no publishes. When `true`, a
   *  single debounced {@link saveCommunityList} runs once the sync settles, and only if the
   *  {@link communityListDirty$} flag was flipped. Explicit membership mutations
   *  ({@link joinByLink}, {@link leave}, {@link createNewCommunity}) always publish regardless
   *  of this flag — they are the sanctioned points to encrypt + sign the list. */
  autoSaveCommunityList?: boolean;
  /** Watch the user's inbox for CORD-05 Direct Invites (community + private-channel invites) during
   *  {@link start}. Defaults to `true`. Discovery is read-only — the watcher never touches the user's
   *  signer unless {@link autoUnlock} is on (which gates its auto-decrypt / NIP-42 auth); otherwise
   *  invites stay pending until the app calls {@link InviteWatcher.readPending}. */
  watchDirectInvites?: boolean;
  /** A custom debug logger (defaults to the "applesauce:concord" namespace). */
  logger?: Debugger;
}

export class ConcordClient {
  readonly signer: ISigner;
  /** The client's debug logger — `options.logger` when injected, otherwise the
   *  `applesauce:concord` module base (D-01/D-02). One client per session, so
   *  no per-instance id suffix at this level (unlike `ConcordCommunity`). */
  private readonly log: Debugger;
  /** The `:invite` sub-logger, derived ONCE in the constructor and reused at
   *  every site that hands a logger to the invite manager/watcher — a fixed
   *  namespace, so a single field replaces what would otherwise be a repeated
   *  `this.log.extend("invite")` at each construction site (constructor +
   *  {@link ensureInviteWatcher}). */
  private readonly inviteLog: Debugger;
  /** The `:publish` sub-logger (D-03 light operational tracing), derived ONCE
   *  in the constructor and reused at every community-list publish trace/
   *  dual-emit site — never re-`.extend()`d per call. */
  private readonly publishLog: Debugger;
  /** Every joined community's current folded state. */
  readonly communities$ = new BehaviorSubject<CommunityState[]>([]);
  /** `"idle"` before `start()`, `"starting"` during startup, `"ready"` afterward. */
  readonly phase$ = new BehaviorSubject<ConcordClientStatus["phase"]>("idle");
  /** A flat snapshot of the manager's status (lifecycle + aggregate sync/connection
   *  across every joined community), for UI to react to as one value. */
  readonly status$: Observable<ConcordClientStatus>;
  /** The active Direct Invite inbox watcher, or `undefined` before it starts. Reactive so UI can
   *  subscribe to its {@link InviteWatcher.needsAuth$} / {@link InviteWatcher.pendingCount$} once
   *  it exists (see {@link watchDirectInvites} / {@link startDirectInviteWatcher}). */
  readonly directInviteWatcher$ = new BehaviorSubject<InviteWatcher | undefined>(undefined);
  /** The user's public invite-link manager (private kind-13303 list + community invite creation). */
  readonly invites: ConcordInviteManager;

  private readonly pool: RelayPool;
  private readonly eventStore: EventStore;
  private readonly storage: ConcordStorage;
  private readonly uploader?: ConcordUploader;
  private readonly defaultRelays: string[];
  /** The RAW `extraRelays` option, kept unresolved so every sub-engine (invite manager, invite
   *  watcher, every community) constructs its own reactive holder from the SAME live source
   *  (D-11/D-13) — never a resolved snapshot, which would freeze sub-engine reactivity. */
  private readonly extraRelaysOption?: ExtraRelaysOption;
  /** The client's own per-operation transport-only extras holder (D-04) — the sole merge
   *  point for this class's own pool calls, via {@link transport}. Never merged into signed
   *  or published content. */
  private readonly extras: ExtraRelays;
  private readonly storeFactory?: ConcordStoreFactory;
  private readonly relayAuth: ConcordRelayAuth;
  private readonly autoUnlock: boolean;
  private readonly autoAuthenticate: boolean;
  private readonly autoSaveCommunityList: boolean;
  private readonly watchDirectInvites: boolean;
  /** The logged-in user as a cast over the shared event store — the source of the exposed
   *  `communityList$` / `inviteList$` observables. Undefined until {@link start} resolves the
   *  pubkey; the exposed getters switch onto it reactively, so they never throw pre-start. */
  private readonly user$ = new BehaviorSubject<User | undefined>(undefined);

  private readonly communities = new Map<string, ConcordCommunity>();
  private readonly stateSubs = new Map<string, Subscription>();
  /** The authoritative 13302 document (CORD-02 §8): two merged, never-clobbered arrays. Both the
   *  local mirror and the relay copy are merged into these through the same primitives, and the
   *  running engine set is derived from them — so a leave on another device reaps the engine here
   *  instead of the stale engine resurrecting the membership. */
  private list: CommunityListCommunity[] = [];
  private tombstones: CommunityTombstone[] = [];
  /** Canonical fingerprint of the list content believed to be on the relay. When a save would
   *  produce identical content we skip the encrypt/sign/publish — 13302 is replaceable, so a
   *  spurious republish (new nonce, new signature, new created_at) can clobber a newer copy from
   *  another device. NIP-44's random nonce means we must compare plaintext content, not ciphertext.
   *  Seeded to the empty-list fingerprint so a brand-new user (no communities, no remote list) never
   *  republishes an empty document on startup; a genuine local-only membership still differs. */
  private publishedListFingerprint: string | null = canonicalJson({ entries: [], tombstones: [] });
  /** Resolves the first time the Community List cast is decrypted + reconciled (fingerprint seeded).
   *  `start()` awaits this before enabling the auto-save flush when the relay served a list, so an
   *  async (e.g. NIP-46 remote) signer's slow decrypt can't lose a race and clobber a newer remote
   *  copy with a save rebuilt from the local mirror. */
  private signalListHydrated?: () => void;
  private listHydration = new Promise<void>((resolve) => (this.signalListHydrated = resolve));
  /** True when the in-memory community list has diverged from the copy we last saved to nostr —
   *  an epoch caught up during sync, or a refounding removal. UI can subscribe to show an
   *  "unpublished changes" indicator, and the opt-in auto-save debounces off it. Set by
   *  {@link markCommunityListDirty}; cleared by {@link saveCommunityList} once back in sync.
   *  Explicit join/leave/create publish immediately; the sync-time flush is opt-in via
   *  {@link ConcordClientOptions.autoSaveCommunityList}. */
  readonly communityListDirty$ = new BehaviorSubject<boolean>(false);
  /** The debounced auto-save subscription over {@link communityListDirty$}, live only while
   *  {@link autoSaveCommunityList} is on (created after hydration in {@link start}). */
  private autoSaveSub?: Subscription;
  private listSub?: Subscription;
  /** Watches the user's gift-wrap inbox for CORD-05 §6 Direct Invites — the delivery
   *  channel for private-channel grants ({@link ConcordCommunity.grantChannelAccess}). */
  private inviteWatcher?: InviteWatcher;
  private directInviteSub?: Subscription;
  /** Direct-invite rumor ids already folded into a community, so a re-emit (the
   *  watcher republishes its full list on every change) doesn't re-merge. */
  private readonly handledInvites = new Set<string>();
  /** List event ids we've already auto-unlocked — the cast re-emits several times per event
   *  (outbox/replaceable churn), so we prompt the user's signer at most once per event id. */
  private readonly autoUnlocked = new Set<string>();
  private started = false;

  constructor(options: ConcordClientOptions) {
    this.log = options.logger ?? logger;
    this.inviteLog = this.log.extend("invite");
    this.publishLog = this.log.extend("publish");
    this.signer = options.signer;
    this.pool = options.pool;
    this.eventStore = options.eventStore ?? new EventStore();
    this.storage = options.storage ?? defaultStorage();
    this.uploader = options.uploader;
    this.defaultRelays = options.relays?.length ? options.relays : STOCK_RELAYS;
    this.extraRelaysOption = options.extraRelays;
    this.extras = new ExtraRelays(options.extraRelays);
    this.log("extras configured=%s", options.extraRelays !== undefined);
    this.storeFactory = options.storeFactory;
    this.autoUnlock = options.autoUnlock ?? false;
    this.autoAuthenticate = options.autoAuthenticate ?? false;
    this.autoSaveCommunityList = options.autoSaveCommunityList ?? false;
    this.watchDirectInvites = options.watchDirectInvites ?? true;
    this.relayAuth = new ConcordRelayAuth(options.pool);
    this.invites = new ConcordInviteManager({
      signer: this.signer,
      pool: this.pool,
      eventStore: this.eventStore,
      relays: this.defaultRelays,
      extraRelays: this.extraRelaysOption,
      autoUnlock: this.autoUnlock,
      getCommunity: (communityId) => this.getCommunity(communityId),
      logger: this.inviteLog,
    });

    // Aggregate status: fold every community's status$ into a single client snapshot.
    // Rebuild the fan-in only when the membership set changes (not on every state fold),
    // so a phase/connection change on a child propagates through the inner combineLatest.
    const childStatuses$ = this.communities$.pipe(
      map(() => [...this.communities.keys()].sort().join(",")),
      distinctUntilChanged(),
      switchMap(() => {
        const engines = [...this.communities.values()];
        if (engines.length === 0) return of([] as ConcordCommunityStatus[]);
        return combineLatest(engines.map((c) => c.status$));
      }),
    );
    this.status$ = combineLatest({ phase: this.phase$, children: childStatuses$ }).pipe(
      map(({ phase, children }): ConcordClientStatus => {
        const live = children.filter((s) => s.phase === "live").length;
        const connectedChildren = children.filter((s) => s.connected);
        return {
          phase,
          communities: children.length,
          syncing: children.length - live,
          live,
          connected: connectedChildren.length > 0,
          authenticated: connectedChildren.length > 0 && connectedChildren.every((s) => s.authenticated),
        };
      }),
      distinctUntilChanged(
        (a, b) =>
          a.phase === b.phase &&
          a.communities === b.communities &&
          a.syncing === b.syncing &&
          a.live === b.live &&
          a.connected === b.connected &&
          a.authenticated === b.authenticated,
      ),
      shareReplay(1),
    );
  }

  /** Merges `base` (defaulting to {@link defaultRelays}) with the current extras snapshot
   *  (D-04) — the ONLY merge point for this class's own transport calls. Every call site here
   *  is one-shot, so the synchronous {@link ExtraRelays.current} snapshot is the correct
   *  consumption shape (D-11) — never a first-value-only resolver. The result is a transport
   *  target set only: it must never be written into signed or published content. */
  private transport(base?: string[]): string[] {
    return this.extras.merge(base ?? this.defaultRelays);
  }

  /** The logged-in user's hex pubkey. Available after {@link start}. */
  get pubkey(): string {
    return this.requireUser().pubkey;
  }

  /** The user's Community List (kind 13302) as a reactive cast — emits `undefined` before
   *  {@link start} and until the event lands in the store; locked until `autoUnlock` or the app
   *  calls `.unlock(signer)`. Safe to subscribe to before start (it switches on once ready). */
  get communityList$(): Observable<ConcordCommunityList | undefined> {
    return this.user$.pipe(switchMap((user) => (user ? user.concordCommunityList$ : of(undefined))));
  }

  /** The user's Invite List (kind 13303) as a reactive cast — same lock/unlock semantics, also
   *  safe before start. */
  get inviteList$(): Observable<ConcordInviteList | undefined> {
    return this.invites.event$;
  }

  private requireUser(): User {
    const user = this.user$.value;
    if (!user) throw new Error("ConcordClient not started — call start() first");
    return user;
  }

  // ---- lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.phase$.next("starting");
    this.log("start requested");
    if (!this.user$.value) this.user$.next(castUser(await this.signer.getPublicKey(), this.eventStore));
    // Restore memberships from the local mirror first (instant, offline-safe),
    // then reconcile with the relay-published Community List (kind 13302).
    await this.loadMirror();
    await this.reconcileCommunities();
    this.watchLists();
    // Pull the user's self-encrypted lists into the store; the cast subscriptions above pick
    // them up (and auto-unlock / reconcile) as they arrive.
    await this.fetchList(COMMUNITY_LIST_KIND);
    // Awaiting the fetch only guarantees the ciphertext landed — not that watchLists decrypted and
    // reconciled it (auto-unlock is async, and slow for remote signers). If the relay served a list,
    // wait for that reconcile (which seeds `publishedListFingerprint` from the relay copy) before we
    // enable auto-save; otherwise a flush could rebuild the list from the local mirror and clobber a
    // newer remote copy. Bounded by the same timeout as the fetch so a decrypt failure can't hang.
    if (this.eventStore.getReplaceable(COMMUNITY_LIST_KIND, this.pubkey)) {
      await Promise.race([this.listHydration, new Promise((r) => setTimeout(r, 8000))]);
    }
    await this.invites.start(this.requireUser());
    if (this.watchDirectInvites) {
      this.startDirectInviteWatcher();
    }
    // No unconditional startup publish: the initial sync is side-effect-free. If autoSave is on,
    // wire the debounced flush now that the remote copy is merged — a dirty flag raised during the
    // sync (epoch catch-up) is replayed to this subscription and flushed once, and later adoptions
    // flush themselves. When autoSave is off, nothing here ever publishes.
    if (this.autoSaveCommunityList) this.startAutoSave();
    this.phase$.next("ready");
    this.log("start complete communities=%d", this.communities.size);
  }

  /** Pause: tears down the running community engines and the invite watcher
   *  instance, restartable via {@link start}. This client's OWN extras holder
   *  ({@link extras}) and the invite manager's ({@link invites}) are
   *  deliberately left alive and subscribed to the app-supplied
   *  `extraRelays` source — `stop()` is restartable, so it must not sever
   *  reactivity a later `start()` would otherwise still expect. The invite
   *  watcher instance itself IS discarded here (a fresh one is constructed on
   *  the next `start()`), so it is disposed (not merely stopped), releasing
   *  its own extras subscription before the discarded instance is dropped. To
   *  release every remaining extras subscription (this client's own, and the
   *  invite manager's), call {@link dispose} instead. */
  stop(): void {
    this.listSub?.unsubscribe();
    this.directInviteSub?.unsubscribe();
    this.autoSaveSub?.unsubscribe();
    this.autoSaveSub = undefined;
    this.inviteWatcher?.dispose();
    this.invites.stop();
    this.inviteWatcher = undefined;
    this.directInviteWatcher$.next(undefined);
    for (const sub of this.stateSubs.values()) sub.unsubscribe();
    this.stateSubs.clear();
    for (const community of this.communities.values()) community.dispose();
    this.communities.clear();
    this.communities$.next([]);
    this.communityListDirty$.next(false);
    this.started = false;
    this.phase$.next("idle");
  }

  /** Releases every engine's subscription to the app-supplied `extraRelays`
   *  source (WR-05): this client's own holder, the invite manager's, and the
   *  invite watcher's (if one is still running — `stop()` already disposes a
   *  discarded watcher, so this is a defensive no-op in the common case).
   *  Unlike {@link stop} (pause-only, restartable), the client is NOT
   *  restartable after `dispose()`. */
  dispose(): void {
    this.stop();
    this.extras.dispose();
    this.invites.dispose();
    this.inviteWatcher?.dispose();
  }

  /**
   * Start watching the user's gift-wrap inbox for CORD-05 §6 Direct Invites and
   * fold any private-channel grants ({@link ConcordCommunity.grantChannelAccess})
   * into the matching community. Shares the client's pool/store/auth; listens on
   * the user's NIP-17 inboxes plus the shared community relays (the fallback),
   * where a co-member's grant lands. Idempotent (guards against double-start).
   */
  startDirectInviteWatcher(): void {
    this.ensureInviteWatcher();
  }

  /** The active direct-invite inbox watcher, if {@link watchDirectInvites} or
   *  {@link startDirectInviteWatcher} has started it. Prefer {@link directInviteWatcher$} in UI. */
  get directInviteWatcher(): InviteWatcher | undefined {
    return this.inviteWatcher;
  }

  private ensureInviteWatcher(): void {
    if (this.inviteWatcher) return;
    this.inviteWatcher = new InviteWatcher({
      signer: this.signer,
      pool: this.pool,
      eventStore: this.eventStore,
      storage: this.storage,
      relays: this.defaultRelays,
      extraRelays: this.extraRelaysOption,
      // Two independent gates, mirroring the client's: `autoUnlock` decrypts incoming Direct
      // Invites, `autoAuthenticate` NIP-42-authenticates as the user. Off by default so the app
      // drives each explicitly via the exposed watcher (`readPending` / `authenticateUser`).
      autoDecrypt: this.autoUnlock,
      autoAuthenticate: this.autoAuthenticate,
      logger: this.inviteLog,
    });
    this.directInviteSub = this.inviteWatcher.invites$.subscribe((invites) => {
      for (const invite of invites) this.onDirectInvite(invite);
    });
    this.directInviteWatcher$.next(this.inviteWatcher);
    void this.inviteWatcher.start().catch((err) => {
      this.inviteLog("invite watcher failed to start: %s", (err as Error)?.message ?? err);
      console.warn("invite watcher failed to start", err);
    });
  }

  /** Fold a decoded Direct Invite's channel keys into the granting community. Only
   *  communities we're already in are touched — a direct invite to a NEW community
   *  is a full-join flow left to the app, not an auto-join here. */
  private onDirectInvite(invite: ConcordDirectInvite): void {
    if (this.handledInvites.has(invite.id) || invite.expired()) return;
    const bundle = invite.bundle;
    if (!bundle) return;
    this.handledInvites.add(invite.id);
    const community = this.communities.get(bundle.community_id);
    if (!community || !bundle.channels?.length) return;
    community.receiveChannelKeys(bundle.channels);
  }

  /** The single-community engine for `cid`, or undefined if not joined. */
  getCommunity(cid: string): ConcordCommunity | undefined {
    return this.communities.get(cid);
  }

  // ---- creating / joining -------------------------------------------------

  async createNewCommunity(name: string, description: string, relays: string[]): Promise<ConcordCommunity> {
    // Never log `name`/`description`: it is unbounded user content in a package
    // whose premise is that community content is end-to-end encrypted. The
    // community id is traced below once `createCommunity` resolves, and that is
    // the stable handle to correlate on.
    this.log("creating community relays=%d", (relays.length ? relays : this.defaultRelays).length);
    const genesis = await createCommunity({
      ownerPubkey: this.pubkey,
      name,
      description,
      relays: relays.length ? relays : this.defaultRelays,
    });
    const community = this.recordJoin(genesis.material);
    await this.saveMirror();
    // Publish genesis control editions (plaintext seal) + owner Join.
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    // Explicit membership mutation — always publish (independent of autoSaveCommunityList).
    await this.saveCommunityList();
    this.log("community created id=%s", community.communityId.slice(0, 8));
    return community;
  }

  async joinByLink(url: string): Promise<ConcordCommunity> {
    const parsed = parseInviteLink(url);
    const relays = parsed.bootstrapRelays.length ? parsed.bootstrapRelays : this.defaultRelays;
    // D-05 (second leak surface in this file, mirroring plan 04's createInvite protocol/
    // transport split): `relays` above stays the unmerged bootstrap-or-default selection and
    // flows on, UNCHANGED, into `joinFromBundle` below — it becomes the joined community's
    // material relays (protocol state). `requestRelays` is a separate local that only widens
    // the bundle FETCH to the merged transport set; never substitute it for `relays` above.
    const requestRelays = this.transport(relays);
    // Collect the whole timeline once the request completes (EOSE), NOT the first
    // emission: `mapEventsToTimeline` seeds an immediate `[]` (via
    // `withImmediateValueOrDefault`) so the pipe never completes empty, which means
    // `firstValueFrom` would resolve with that synchronous `[]` before any relay
    // replies — the invite bundle would never be fetched. `lastValueFrom` waits for
    // completion and yields the fully-accumulated timeline.
    // INVITE-01/D-02: scope to the empty `d` identifier so a sibling coordinate
    // (same author+kind, different `d`) can never pollute the union.
    const events = await lastValueFrom(
      this.pool
        .request(requestRelays, [{ kinds: [INVITE_BUNDLE_KIND], authors: [parsed.linkSigner], "#d": [""] }])
        .pipe(mapEventsToTimeline(), timeout(10000)),
      { defaultValue: [] as NostrEvent[] },
    ).catch(() => [] as NostrEvent[]);

    // INVITE-01/D-01/D-03: collapse the FULL relay union (all editions, tombstone
    // included) to the single newest-at-coordinate winner FIRST, then evaluate
    // revocation on that single winner — filtering revoked editions out before
    // sorting would let a lagging relay's stale live bundle win (CORD-05 §2).
    // INVITE-01/D-02: re-enforce the coordinate on inbound events (see
    // isAtCoordinate) — a misbehaving relay is not trusted to have honored the
    // outgoing authors/#d filter, so an off-coordinate injected event can never
    // win the collapse.
    const winner = newestAtCoordinate(
      events.filter((e) => isValidInviteBundle(e) && isAtCoordinate(e, parsed.linkSigner)),
    );
    if (!winner || isInviteBundleRevoked(winner)) throw new Error("invite bundle not found or revoked");

    // Bound and self-certify the attacker-crafted bundle (CORD-05 §1).
    const bundle = validateInviteBundle(getInviteBundle(winner, parsed.token));
    if (!bundle) throw new Error("invite failed owner verification");

    return this.joinFromBundle(bundle, relays);
  }

  /**
   * Accept a CORD-05 §6 Direct Invite to a **new** community: join from the
   * invite's self-certified §1 bundle (e.g. `ConcordDirectInvite.bundle`). A
   * Direct Invite for a community we're already in has its channel keys folded in
   * automatically by {@link InviteWatcher}; this drives the full-join flow the
   * watcher deliberately leaves to the app. Returns the existing engine if we are
   * already a member.
   */
  async joinByBundle(bundle: InviteBundle): Promise<ConcordCommunity> {
    return this.joinFromBundle(bundle, this.defaultRelays);
  }

  /** The shared tail of {@link joinByLink} / {@link joinByBundle}: turn an
   *  already-validated §1 bundle into a joined community (add engine, persist,
   *  publish our attributed Join, republish the list). */
  private async joinFromBundle(bundle: InviteBundle, fallbackRelays: string[]): Promise<ConcordCommunity> {
    this.log("join requested community=%s", bundle.community_id.slice(0, 8));
    // INVITE-04/D-05: expires_at is unix SECONDS end-to-end — compare against
    // unixNow() (seconds), never Date.now() (JS's epoch clock, a different scale).
    // See helpers/__tests__/invite-bundle.test.ts for the dual-citation spec rationale.
    if (bundle.expires_at && unixNow() > bundle.expires_at) throw new Error("invite expired");

    const material: JoinMaterial = {
      community_id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      channels: bundle.channels ?? [],
      relays: bundle.relays.length ? bundle.relays : fallbackRelays,
      name: bundle.name,
      // Canonicalize to [] (invite bundles omit held_roots) so this join material
      // is byte-identical to what the engine's `buildChain` settles on — otherwise
      // the post-start Community List refresh re-signs 13302 a second time (an extra
      // signer.signEvent + nip44.encrypt on every join). A genuine epoch adoption
      // during sync still legitimately differs and publishes.
      held_roots: bundle.held_roots ?? [],
      refounder: bundle.refounder,
    };

    // If we're already in the community, return the existing community.
    if (this.communities.has(material.community_id)) {
      this.log("join skipped — already a member community=%s", material.community_id.slice(0, 8));
      return this.communities.get(material.community_id)!;
    }

    const community = this.recordJoin(material);
    await this.saveMirror();
    // Publish our Join (with attribution, CORD-05).
    const joinRumor = await JoinLeaveFactory.create("join", {
      invite: bundle.creator_npub ? { creator: bundle.creator_npub, label: bundle.label } : undefined,
    });
    await community.publishToPlane({ plane: "guestbook" }, joinRumor, {});
    // Accepting an invite is an explicit mutation — always publish the updated list.
    await this.saveCommunityList();
    this.log("joined community=%s", community.communityId.slice(0, 8));
    return community;
  }

  async leave(cid: string): Promise<void> {
    const community = this.communities.get(cid);
    if (!community) return;
    this.log("leave requested community=%s", cid.slice(0, 8));
    await community.leave();
    this.removeCommunity(cid);
    // Tombstone the membership so the leave propagates across devices/clients
    // (a bare omission would merge back as still-joined — CORD-02 §8).
    this.tombstones = leaveCommunity(cid, Date.now())(this.list, this.tombstones).tombstones;
    await this.saveMirror();
    // Leaving is an explicit mutation — always publish the tombstoned list.
    await this.saveCommunityList();
    this.log("left community=%s", cid.slice(0, 8));
  }

  // ---- internal: community lifecycle --------------------------------------

  /** Record an **explicit** join (create/accept-invite) in the document and start its engine.
   *  Stamping `added_at` here — at the one moment the user actually opted in — is what lets a
   *  re-join outlive an older tombstone (CORD-02 §8) without the save path having to infer intent
   *  from the running engine set, which cannot tell a deliberate re-join from a stale engine. */
  private recordJoin(material: JoinMaterial): ConcordCommunity {
    this.list = joinCommunity({
      community_id: material.community_id,
      seed: material,
      current: material,
      added_at: Date.now(),
    })(this.list, this.tombstones).communities;
    return this.addCommunity(material);
  }

  private addCommunity(material: JoinMaterial): ConcordCommunity {
    const community = new ConcordCommunity({
      material,
      signer: this.signer,
      pubkey: this.pubkey,
      pool: this.pool,
      relayAuth: this.relayAuth,
      eventStore: this.eventStore,
      uploader: this.uploader,
      relays: this.defaultRelays,
      extraRelays: this.extraRelaysOption,
      storeFactory: this.storeFactory
        ? (_cid, planeKey) => this.storeFactory!(material.community_id, planeKey)
        : undefined,
      logger: this.log.extend("community").extend(material.community_id.slice(0, 8)),
      onMaterialChange: (changed) => {
        // Fold the engine's new snapshot into the document in place, so the mirror we persist and
        // the list we publish always carry what the engine actually holds. `refreshCommunity`
        // bypasses the epoch-keyed `freshest` merge, so a same-epoch change (a minted channel key)
        // can't lose the canonical-bytes tiebreak against the snapshot it replaces.
        this.list = refreshCommunity(changed)(this.list, this.tombstones).communities;
        void this.saveMirror();
        // A sync-time change (epoch catch-up). Never publishes on its own — it flags the list
        // dirty; the opt-in debounced auto-save flushes it, or the app publishes manually.
        this.markCommunityListDirty();
      },
      onRemoved: (removed) => this.handleRemoved(removed),
      onInviteCreated: (invite) => this.invites.record(invite),
      onInviteRevoked: (invite) => this.invites.tombstone(invite),
      onRefounded: (cid) => this.refreshInvitesFor(cid),
    });
    this.communities.set(material.community_id, community);
    this.stateSubs.set(
      material.community_id,
      community.state$.subscribe(() => this.emitCommunities()),
    );
    void community.start();
    this.emitCommunities();
    return community;
  }

  private removeCommunity(cid: string): void {
    this.stateSubs.get(cid)?.unsubscribe();
    this.stateSubs.delete(cid);
    this.communities.get(cid)?.dispose();
    this.communities.delete(cid);
    this.emitCommunities();
  }

  /** A Refounding excluded us (CORD-06): drop the community and tombstone it. */
  private handleRemoved(cid: string): void {
    this.removeCommunity(cid);
    this.tombstones = leaveCommunity(cid, Date.now())(this.list, this.tombstones).tombstones;
    void this.saveMirror();
    // Involuntary removal during sync/live — flag dirty rather than publish inline so a sync stays
    // side-effect-free; the opt-in auto-save (or a later explicit mutation) propagates the tombstone.
    this.markCommunityListDirty();
  }

  private emitCommunities(): void {
    this.communities$.next([...this.communities.values()].map((c) => c.state$.value));
  }

  /** Re-post a community's live invite bundles after a Refounding (CORD-05 §2). The
   *  Invite List holds the per-link signer secrets, so the refresh is driven here
   *  and handed to the community engine, which rebuilds each bundle from the fresh
   *  material. Revoked links are skipped — their coordinate is already a tombstone. */
  private refreshInvitesFor(cid: string): void {
    const community = this.communities.get(cid);
    if (!community) return;
    const links = this.invites.forCommunity(cid).filter((link) => !link.revoked);
    if (links.length === 0) return;
    this.publishLog("refreshing %d invite bundle(s) community=%s", links.length, cid.slice(0, 8));
    void community.refreshInviteBundles(links).catch((err) => {
      this.publishLog("invite refresh failed community=%s: %s", cid.slice(0, 8), (err as Error)?.message ?? err);
      console.warn("invite refresh failed", err);
    });
  }

  // ---- local mirror of the community list ----------------------------------

  /** Read the local mirror and merge it into the document. The mirror holds the same
   *  `{entries, tombstones}` shape the relay copy does, so local and remote state combine through
   *  the identical CORD-02 §8 primitives — a mirror can contribute an unpublished join but can
   *  never clobber a tombstone another device wrote. */
  private async loadMirror(): Promise<void> {
    try {
      const raw = await this.storage.getItem(this.pubkey);
      if (!raw) return;
      const mirror = this.parseMirror(raw);
      this.list = mergeCommunities(this.list, mirror.communities);
      this.tombstones = mergeCommunityTombstones(this.tombstones, mirror.tombstones);
    } catch (err) {
      this.log("failed to read the local community mirror: %s", (err as Error)?.message ?? err);
      console.warn("failed to read the local community mirror", err);
    }
  }

  /** Parse a mirror payload, migrating the legacy format (a bare `JoinMaterial[]` — a membership
   *  set with no `added_at` and no tombstones) in place. Legacy memberships seed `added_at: 0` so
   *  any tombstone the relay copy carries outranks them: a device whose mirror predates this format
   *  must not undo a leave it never witnessed. An unpublished legacy join still survives, because
   *  liveness only consults `added_at` when a tombstone exists at all. */
  private parseMirror(raw: string): { communities: CommunityListCommunity[]; tombstones: CommunityTombstone[] } {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return parseCommunityList(raw);
    return {
      communities: (parsed as JoinMaterial[])
        .filter((material) => typeof material?.community_id === "string")
        .map((material) => ({
          community_id: material.community_id,
          seed: material,
          current: material,
          added_at: 0,
        })),
      tombstones: [],
    };
  }

  private async saveMirror(): Promise<void> {
    try {
      // Keyed as `entries` to match the wire document (armada-compatible), so the mirror and the
      // 13302 plaintext stay parseable by the same helper.
      await this.storage.setItem(this.pubkey, JSON.stringify({ entries: this.list, tombstones: this.tombstones }));
    } catch (err) {
      this.log("failed to mirror communities locally: %s", (err as Error)?.message ?? err);
      console.warn("failed to mirror communities locally", err);
    }
  }

  // ---- community list (kind 13302) ----------------------------------------

  /** Pipe every version of a self-encrypted list (13302/13303) the relays hold into the
   *  shared store; the EventStore keeps the newest replaceable, so no manual sort/pick. Reads
   *  through {@link transport}: only the transport target widens here, while the list's own
   *  content continues to carry each community's material relays untouched. */
  private fetchList(kind: number): Promise<unknown> {
    return firstValueFrom(
      this.pool
        .request(this.transport(), [{ kinds: [kind], authors: [this.pubkey] }])
        .pipe(mapEventsToStore(this.eventStore), toArray(), timeout(8000)),
    ).catch(() => [] as NostrEvent[]);
  }

  /** Subscribe to the exposed list casts: auto-unlock when configured, and (for the Community
   *  List) reconcile the decrypted memberships into our arrays and bootstrap the engines.
   *  Reconcile fires on every decrypted emission — whether the unlock was ours or the app's
   *  — because the cast's `communities$` re-emits on `update$` after `notifyEventUpdate`. */
  private watchLists(): void {
    this.listSub = this.requireUser()
      .concordCommunityList$.pipe(switchMap((cast) => (cast ? cast.communities$.pipe(map(() => cast)) : of(undefined))))
      .subscribe((cast) => {
        if (!cast) return;
        if (this.autoUnlock && !cast.unlocked) {
          this.autoUnlockCast(cast);
          return; // unlock → notifyEventUpdate re-emits us with the decrypted communities
        }
        const communities = cast.communities;
        if (!communities) return; // still locked → wait for the app to call .unlock()
        // Merge into our arrays rather than replace (CORD-02 §8).
        this.list = mergeCommunities(this.list, communities);
        this.tombstones = mergeCommunityTombstones(this.tombstones, cast.tombstones ?? []);
        // Seed the fingerprint from the REMOTE-only content (not the merged `this.list`) so a
        // genuine local-only addition can still publish, but a save that would reproduce exactly
        // what the relay already holds is skipped. A self-published event echoing back here
        // re-seeds this to the same value → idempotent, no loop.
        this.publishedListFingerprint = canonicalJson({
          entries: mergeCommunities([], communities),
          tombstones: mergeCommunityTombstones([], cast.tombstones ?? []),
        });
        this.signalListHydrated?.(); // release start()'s pre-auto-save wait now the relay copy is merged
        void this.reconcileCommunities();
      });
  }

  /** Issue the user-signer decrypt of a list cast at most once per event id. The unlock's
   *  `notifyEventUpdate` re-emits the now-decrypted cast for the reconcile path. */
  private autoUnlockCast(cast: ConcordCommunityList): void {
    if (!this.signer.nip44 || this.autoUnlocked.has(cast.id)) return;
    this.autoUnlocked.add(cast.id);
    void cast.unlock(this.signer).catch(() => {});
  }

  /** Drive the running engine set to exactly the live memberships derived from the merged document
   *  (CORD-02 §8): start what's live and isn't running, stop what's running and is no longer live.
   *  The reap is the half that makes a leave propagate — without it a membership tombstoned on
   *  another device keeps its engine (and its place in `communities$`) forever, and would be
   *  republished as live on the next save. */
  private async reconcileCommunities(): Promise<void> {
    const live = new Map(liveCommunities(this.list, this.tombstones).map((e) => [e.community_id, e]));
    let changed = false;
    for (const cid of [...this.communities.keys()]) {
      if (live.has(cid)) continue;
      this.removeCommunity(cid);
      changed = true;
    }
    for (const [cid, community] of live) {
      if (this.communities.has(cid) || !community.current?.community_id) continue;
      this.addCommunity(community.current);
      changed = true;
    }
    if (changed) await this.saveMirror();
  }

  /** Flag the community list as needing a re-publish (a sync-time epoch catch-up or a refounding
   *  removal). Emitting on each change resets the auto-save debounce so a burst of adoptions
   *  collapses into one save; UI subscribers see the "unpublished changes" state. */
  private markCommunityListDirty(): void {
    this.communityListDirty$.next(true);
  }

  /** Wire the opt-in debounced flush: whenever the list is dirty, publish once after the changes
   *  settle. Created only after the remote copy is merged (post-hydration in {@link start}) so a
   *  flush can't rebuild from the local mirror and clobber a newer relay copy. Because
   *  {@link communityListDirty$} is a BehaviorSubject, a dirty flag raised before this subscription
   *  exists is replayed on subscribe and still flushes. */
  private startAutoSave(): void {
    if (this.autoSaveSub) return;
    this.autoSaveSub = this.communityListDirty$
      .pipe(
        filter((dirty) => dirty),
        debounceTime(COMMUNITY_LIST_FLUSH_DEBOUNCE_MS),
      )
      .subscribe(() => {
        if (this.communityListDirty$.value) void this.saveCommunityList();
      });
  }

  /** Encrypt/sign/publish the user's Community List (kind 13302) when local memberships
   *  differ from the last known relay copy. No-op (no signer call) when content is unchanged,
   *  and clears {@link communityListDirty$} once the list is back in sync. */
  async saveCommunityList(): Promise<void> {
    if (!this.signer.nip44) return;
    try {
      // Serialize the document as-is. Joins stamp `added_at` in `recordJoin`, leaves tombstone in
      // `leave`/`handleRemoved`, and engine snapshots fold in via `onMaterialChange` — so there is
      // nothing to reconstruct here, and in particular no re-deriving membership from the engine
      // map (which cannot distinguish a deliberate re-join from an engine still running against a
      // membership another device already left).
      const list = this.list;
      const tombstones = this.tombstones;
      // Content-fingerprint dirty check: 13302 is replaceable, so skip the encrypt/sign/publish
      // when the content is byte-for-byte what we believe is already on the relay. Compare
      // canonical PLAINTEXT (NIP-44's random nonce makes ciphertext comparison useless).
      const fingerprint = canonicalJson({ entries: list, tombstones });
      if (fingerprint === this.publishedListFingerprint) {
        this.clearCommunityListDirty(); // already in sync with the relay copy
        return;
      }
      if (!communityListWithinByteCap(list, tombstones)) {
        this.publishLog("community list exceeds the NIP-44 byte cap; not publishing");
        console.warn("community list exceeds the NIP-44 byte cap; not publishing");
        return;
      }
      // Only the transport target widens here (via {@link transport}) — the list's own content
      // (`list`/`tombstones`, serialized below) continues to carry each community's material
      // relays untouched. Computed once and reused for the trace and the publish call so the two
      // can never disagree.
      const targets = this.transport();
      this.publishLog(
        "publishing community list entries=%d tombstones=%d targets=%d",
        list.length,
        tombstones.length,
        targets.length,
      );
      const plaintext = JSON.stringify({ entries: list, tombstones });
      const content = await this.signer.nip44.encrypt(this.pubkey, plaintext);
      // 13302 is replaceable: NIP-01 keeps the lowest event id on a created_at tie, so a save
      // within the same second as the edition already on the relay could lose that tie and be
      // dropped. Stamp a strictly-greater created_at than the last known edition so this always
      // supersedes it.
      const previous = this.eventStore.getReplaceable(COMMUNITY_LIST_KIND, this.pubkey);
      const createdAt = Math.max(Math.floor(Date.now() / 1000), (previous?.created_at ?? 0) + 1);
      const signed = await this.signer.signEvent({
        kind: COMMUNITY_LIST_KIND,
        content,
        tags: [],
        created_at: createdAt,
      });
      // Prime the plaintext BEFORE adding: `eventStore.add` notifies subscribers synchronously,
      // so the exposed cast (and the auto-unlock path) must already see this event as unlocked —
      // otherwise auto-unlock would re-issue a redundant user-signer decrypt of a list we just wrote.
      setHiddenContentCache(signed, plaintext);
      this.eventStore.add(signed);
      this.pool.publish(targets, signed).catch((err) => {
        this.publishLog("list publish failed: %s", (err as Error)?.message ?? err);
        console.warn("list publish failed", err);
      });
      // Record what we just put on the relay so an immediate re-save (or the echo) is a no-op.
      this.publishedListFingerprint = fingerprint;
      this.clearCommunityListDirty();
    } catch (err) {
      this.publishLog("failed to save community list: %s", (err as Error)?.message ?? err);
      console.warn("failed to save community list", err);
    }
  }

  /** Mark the community list as back in sync with the relay copy. */
  private clearCommunityListDirty(): void {
    this.communityListDirty$.next(false);
  }
}
