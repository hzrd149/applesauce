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
  distinctUntilChanged,
  firstValueFrom,
  map,
  of,
  shareReplay,
  switchMap,
  timeout,
  toArray,
} from "rxjs";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { castUser, type User } from "applesauce-core/casts";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { setHiddenContentCache } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";

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
  isCommunityLive,
  mergeCommunities,
  mergeCommunityTombstones,
} from "../helpers/community-list.js";
import { INVITE_LIST_KIND } from "../helpers/invite-list.js";
import {
  INVITE_BUNDLE_KIND,
  STOCK_RELAYS,
  getInviteBundle,
  isInviteBundleRevoked,
  isValidInviteBundle,
  parseInviteLink,
  validateInviteBundle,
} from "../helpers/invite-bundle.js";
import { joinCommunity, leaveCommunity, refreshCommunity } from "../operations/community-list.js";
import { JoinLeaveFactory } from "../factories/guestbook.js";
import { InviteWatcher } from "./invite-watcher.js";
import type { ConcordDirectInvite } from "../casts/direct-invite.js";
import type {
  CommunityListCommunity,
  CommunityState,
  CommunityTombstone,
  ConcordClientStatus,
  ConcordCommunityStatus,
  JoinMaterial,
} from "../types.js";
import { ConcordCommunity } from "./community.js";

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
  /** Per-plane store factory (persistent cache), passed through to every community. */
  storeFactory?: ConcordStoreFactory;
  /** Automatically issue the user-signer decryption of the Community/Invite lists (kind
   *  13302/13303) when they arrive, instead of waiting for the app to call `.unlock()` on
   *  the exposed cast. Defaults to `false` so the user isn't prompted without intent — this
   *  gates ONLY the self-encrypted list decryptions; community-plane decryptions (derived
   *  group keys, no prompt) always happen automatically. */
  autoUnlock?: boolean;
}

export class ConcordClient {
  readonly signer: ISigner;
  /** Every joined community's current folded state. */
  readonly communities$ = new BehaviorSubject<CommunityState[]>([]);
  /** `"idle"` before `start()`, `"starting"` during startup, `"ready"` afterward. */
  readonly phase$ = new BehaviorSubject<ConcordClientStatus["phase"]>("idle");
  /** A flat snapshot of the manager's status (lifecycle + aggregate sync/connection
   *  across every joined community), for UI to react to as one value. */
  readonly status$: Observable<ConcordClientStatus>;

  private readonly pool: RelayPool;
  private readonly eventStore: EventStore;
  private readonly storage: ConcordStorage;
  private readonly uploader?: ConcordUploader;
  private readonly defaultRelays: string[];
  private readonly storeFactory?: ConcordStoreFactory;
  private readonly relayAuth: ConcordRelayAuth;
  private readonly autoUnlock: boolean;
  /** The logged-in user as a cast over the shared event store — the source of the exposed
   *  `communityList$` / `inviteList$` observables. Initialized in {@link start}. */
  private user?: User;
  /** Resolved from the signer in {@link start}. */
  private _pubkey?: string;

  private readonly communities = new Map<string, ConcordCommunity>();
  private readonly stateSubs = new Map<string, Subscription>();
  /** The authoritative 13302 document (CORD-02 §8): two merged, never-clobbered arrays. */
  private list: CommunityListCommunity[] = [];
  private tombstones: CommunityTombstone[] = [];
  /** Canonical fingerprint of the list content believed to be on the relay. When a save would
   *  produce identical content we skip the encrypt/sign/publish — 13302 is replaceable, so a
   *  spurious republish (new nonce, new signature, new created_at) can clobber a newer copy from
   *  another device. NIP-44's random nonce means we must compare plaintext content, not ciphertext.
   *  Seeded to the empty-list fingerprint so a brand-new user (no communities, no remote list) never
   *  republishes an empty document on startup; a genuine local-only membership still differs. */
  private publishedListFingerprint: string | null = canonicalJson({ entries: [], tombstones: [] });
  /** True once the initial remote 13302 has been fetched + reconciled (or confirmed absent). A
   *  reactive (key-roll driven) save must not publish before we've merged the relay's copy, or it
   *  would push a partial list. */
  private listHydrated = false;
  /** Resolves the first time the Community List cast is decrypted + reconciled (fingerprint seeded).
   *  `start()` waits on this before its startup flush when the relay served a list, so an async
   *  (e.g. NIP-46 remote) signer's slow decrypt can't lose a race to the flush and clobber a newer
   *  remote copy with a republish rebuilt from the local mirror. */
  private signalListHydrated?: () => void;
  private listHydration = new Promise<void>((resolve) => (this.signalListHydrated = resolve));
  private listSub?: Subscription;
  private inviteSub?: Subscription;
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
    this.signer = options.signer;
    this.pool = options.pool;
    this.eventStore = options.eventStore ?? new EventStore();
    this.storage = options.storage ?? defaultStorage();
    this.uploader = options.uploader;
    this.defaultRelays = options.relays?.length ? options.relays : STOCK_RELAYS;
    this.storeFactory = options.storeFactory;
    this.autoUnlock = options.autoUnlock ?? false;
    this.relayAuth = new ConcordRelayAuth(options.pool);

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

  /** The logged-in user's hex pubkey. Available after {@link start}. */
  get pubkey(): string {
    if (!this._pubkey) throw new Error("ConcordClient not started — call start() first");
    return this._pubkey;
  }

  /** The user's Community List (kind 13302) as a reactive cast — `undefined` until the event
   *  lands in the store; locked until `autoUnlock` or the app calls `.unlock(signer)`. */
  get communityList$(): Observable<ConcordCommunityList | undefined> {
    return this.requireUser().concordCommunityList$;
  }

  /** The user's Invite List (kind 13303) as a reactive cast — same lock/unlock semantics. */
  get inviteList$(): Observable<ConcordInviteList | undefined> {
    return this.requireUser().concordInviteList$;
  }

  private requireUser(): User {
    if (!this.user) throw new Error("ConcordClient not started — call start() first");
    return this.user;
  }

  // ---- lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.phase$.next("starting");
    this._pubkey = await this.signer.getPublicKey();
    this.user ??= castUser(this._pubkey, this.eventStore);
    // Restore memberships from the local mirror first (instant, offline-safe),
    // then reconcile with the relay-published Community List (kind 13302).
    for (const material of await this.loadMaterials()) {
      if (!this.communities.has(material.community_id)) this.addCommunity(material);
    }
    this.watchLists();
    // Pull the user's self-encrypted lists into the store; the cast subscriptions above pick
    // them up (and auto-unlock / reconcile) as they arrive.
    await this.fetchList(COMMUNITY_LIST_KIND);
    // Awaiting the fetch only guarantees the ciphertext landed — not that watchLists decrypted and
    // reconciled it (auto-unlock is async, and slow for remote signers). If the relay served a list,
    // wait for that reconcile (which seeds `publishedListFingerprint` from the relay copy) before we
    // flush; otherwise a startup save could rebuild the list from the local mirror and clobber a
    // newer remote copy. Bounded by the same timeout as the fetch so a decrypt failure can't hang.
    if (this.eventStore.getReplaceable(COMMUNITY_LIST_KIND, this.pubkey)) {
      await Promise.race([this.listHydration, new Promise((r) => setTimeout(r, 8000))]);
    }
    this.listHydrated = true; // reconciled, confirmed absent, or timed out — the flush may proceed
    void this.fetchList(INVITE_LIST_KIND);
    this.startInviteWatcher();
    // Dirty-checked flush: a no-op unless startup surfaced a genuine local/remote divergence.
    await this.saveCommunityList();
    this.phase$.next("ready");
  }

  stop(): void {
    this.listSub?.unsubscribe();
    this.inviteSub?.unsubscribe();
    this.directInviteSub?.unsubscribe();
    this.inviteWatcher?.stop();
    this.inviteWatcher = undefined;
    for (const sub of this.stateSubs.values()) sub.unsubscribe();
    this.stateSubs.clear();
    for (const community of this.communities.values()) community.dispose();
    this.communities.clear();
    this.communities$.next([]);
    this.started = false;
    this.phase$.next("idle");
  }

  /**
   * Start watching the user's gift-wrap inbox for CORD-05 §6 Direct Invites and
   * fold any private-channel grants ({@link ConcordCommunity.grantChannelAccess})
   * into the matching community. Shares the client's pool/store/auth; listens on
   * the user's NIP-17 inboxes plus the shared community relays (the fallback),
   * where a co-member's grant lands. Idempotent (guards against double-start).
   */
  private startInviteWatcher(): void {
    if (this.inviteWatcher) return;
    this.inviteWatcher = new InviteWatcher({
      signer: this.signer,
      pool: this.pool,
      eventStore: this.eventStore,
      storage: this.storage,
      relays: this.defaultRelays,
      autoDecrypt: true,
    });
    this.directInviteSub = this.inviteWatcher.invites$.subscribe((invites) => {
      for (const invite of invites) this.onDirectInvite(invite);
    });
    void this.inviteWatcher.start().catch((err) => console.warn("invite watcher failed to start", err));
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

  getState$(cid: string): BehaviorSubject<CommunityState> | undefined {
    return this.communities.get(cid)?.state$;
  }

  // ---- creating / joining -------------------------------------------------

  async createNewCommunity(name: string, description: string, relays: string[]): Promise<string> {
    const genesis = await createCommunity({
      ownerPubkey: this.pubkey,
      name,
      description,
      relays: relays.length ? relays : this.defaultRelays,
    });
    const community = this.addCommunity(genesis.material);
    await this.saveMaterials();
    // Publish genesis control editions (plaintext seal) + owner Join.
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await this.saveCommunityList();
    return genesis.material.community_id;
  }

  async joinByLink(url: string): Promise<ConcordCommunity> {
    const parsed = parseInviteLink(url);
    const relays = parsed.bootstrapRelays.length ? parsed.bootstrapRelays : this.defaultRelays;
    const events = await firstValueFrom(
      this.pool
        .request(relays, [{ kinds: [INVITE_BUNDLE_KIND], authors: [parsed.linkSigner] }])
        .pipe(mapEventsToTimeline(), timeout(10000)),
    ).catch(() => [] as NostrEvent[]);

    const live = events
      .filter((e) => isValidInviteBundle(e) && !isInviteBundleRevoked(e))
      .sort((a, b) => b.created_at - a.created_at)[0];
    if (!live) throw new Error("invite bundle not found or revoked");

    // Bound and self-certify the attacker-crafted bundle (CORD-05 §1).
    const bundle = validateInviteBundle(getInviteBundle(live, parsed.token));
    if (!bundle) throw new Error("invite failed owner verification");
    if (bundle.expires_at && Date.now() > bundle.expires_at) throw new Error("invite expired");

    const material: JoinMaterial = {
      community_id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      channels: bundle.channels ?? [],
      relays: bundle.relays.length ? bundle.relays : relays,
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
    if (this.communities.has(material.community_id)) return this.communities.get(material.community_id)!;

    const community = this.addCommunity(material);
    await this.saveMaterials();
    // Publish our Join (with attribution, CORD-05).
    const joinRumor = await JoinLeaveFactory.create("join", {
      invite: bundle.creator_npub ? { creator: bundle.creator_npub, label: bundle.label } : undefined,
    });
    await community.publishToPlane({ plane: "guestbook" }, joinRumor, {});
    await this.saveCommunityList();
    return community;
  }

  async leave(cid: string): Promise<void> {
    const community = this.communities.get(cid);
    if (!community) return;
    await community.leave();
    this.removeCommunity(cid);
    // Tombstone the membership so the leave propagates across devices/clients
    // (a bare omission would merge back as still-joined — CORD-02 §8).
    this.tombstones = leaveCommunity(cid, Date.now())(this.list, this.tombstones).tombstones;
    await this.saveMaterials();
    await this.saveCommunityList();
  }

  // ---- internal: community lifecycle --------------------------------------

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
      storeFactory: this.storeFactory
        ? (_cid, planeKey) => this.storeFactory!(material.community_id, planeKey)
        : undefined,
      onMaterialChange: () => {
        void this.saveMaterials();
        void this.saveCommunityList({ reactive: true });
      },
      onRemoved: (removed) => this.handleRemoved(removed),
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
    void this.saveMaterials();
    void this.saveCommunityList();
  }

  private emitCommunities(): void {
    this.communities$.next([...this.communities.values()].map((c) => c.state$.value));
  }

  // ---- local material mirror ----------------------------------------------

  private async loadMaterials(): Promise<JoinMaterial[]> {
    try {
      const raw = await this.storage.getItem(this.pubkey);
      return raw ? (JSON.parse(raw) as JoinMaterial[]) : [];
    } catch {
      return [];
    }
  }

  private async saveMaterials(): Promise<void> {
    try {
      const materials = [...this.communities.values()].map((c) => c.material);
      await this.storage.setItem(this.pubkey, JSON.stringify(materials));
    } catch (err) {
      console.warn("failed to mirror communities locally", err);
    }
  }

  // ---- community list (kind 13302) ----------------------------------------

  /** Pipe every version of a self-encrypted list (13302/13303) the relays hold into the
   *  shared store; the EventStore keeps the newest replaceable, so no manual sort/pick. */
  private fetchList(kind: number): Promise<unknown> {
    return firstValueFrom(
      this.pool
        .request(this.defaultRelays, [{ kinds: [kind], authors: [this.pubkey] }])
        .pipe(mapEventsToStore(this.eventStore), toArray(), timeout(8000)),
    ).catch(() => [] as NostrEvent[]);
  }

  /** Subscribe to the exposed list casts: auto-unlock when configured, and (for the Community
   *  List) reconcile the decrypted memberships into our arrays and bootstrap the engines.
   *  Reconcile fires on every decrypted emission — whether the unlock was ours or the app's
   *  — because the cast's `communities$` re-emits on `update$` after `notifyEventUpdate`. */
  private watchLists(): void {
    this.listSub = this.requireUser().concordCommunityList$
      .pipe(switchMap((cast) => (cast ? cast.communities$.pipe(map(() => cast)) : of(undefined))))
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
        this.listHydrated = true;
        this.signalListHydrated?.(); // release start()'s pre-flush wait now the relay copy is merged
        void this.reconcileCommunities();
      });

    // Nothing consumes the Invite List yet — just auto-unlock it so the exposed cast is
    // populated for the app when `autoUnlock` is on.
    this.inviteSub = this.requireUser().concordInviteList$.subscribe((cast) => {
      if (this.autoUnlock && cast && !cast.unlocked) this.autoUnlockCast(cast);
    });
  }

  /** Issue the user-signer decrypt of a list cast at most once per event id. The unlock's
   *  `notifyEventUpdate` re-emits the now-decrypted cast for the reconcile path. */
  private autoUnlockCast(cast: ConcordCommunityList | ConcordInviteList): void {
    if (!this.signer.nip44 || this.autoUnlocked.has(cast.id)) return;
    this.autoUnlocked.add(cast.id);
    void cast.unlock(this.signer).catch(() => {});
  }

  /** Spin up any live membership from the merged list that isn't already running. */
  private async reconcileCommunities(): Promise<void> {
    let added = false;
    for (const community of this.list) {
      const m = community.current;
      if (!m?.community_id || !isCommunityLive(this.list, this.tombstones, m.community_id)) continue;
      if (!this.communities.has(m.community_id)) {
        this.addCommunity(m);
        added = true;
      }
    }
    if (added) await this.saveMaterials();
  }

  private async saveCommunityList(opts?: { reactive?: boolean }): Promise<void> {
    if (!this.signer.nip44) return;
    // A reactive (key-roll driven) save before hydration must be a complete no-op: the engine loop
    // below would fold local memberships into `this.list` with a fresh `added_at`, and since merge
    // keeps the newer `added_at` the relay's original value is lost — making the post-hydration
    // startup flush look dirty and republish. Bail before touching `this.list`; the awaited startup
    // flush (start(), non-reactive, after the remote copy is merged) runs the real reconciliation.
    if (opts?.reactive && !this.listHydrated) return;
    try {
      const nowMs = Date.now();
      let list = this.list;
      const tombstones = this.tombstones;
      for (const community of this.communities.values()) {
        const cid = community.communityId;
        const existing = list.find((e) => e.community_id === cid);
        if (!existing) {
          list = joinCommunity({
            community_id: cid,
            seed: community.material,
            current: community.material,
            added_at: nowMs,
          })(list, tombstones).communities;
          continue;
        }
        list = refreshCommunity(community.material)(list, tombstones).communities;
        const tomb = tombstones.find((t) => t.community_id === cid);
        if (tomb && existing.added_at <= tomb.removed_at) {
          list = joinCommunity({ ...existing, current: community.material, added_at: nowMs })(
            list,
            tombstones,
          ).communities;
        }
      }
      this.list = list;
      // Content-fingerprint dirty check: 13302 is replaceable, so skip the encrypt/sign/publish
      // when the content is byte-for-byte what we believe is already on the relay. Compare
      // canonical PLAINTEXT (NIP-44's random nonce makes ciphertext comparison useless).
      const fingerprint = canonicalJson({ entries: list, tombstones });
      if (fingerprint === this.publishedListFingerprint) return;
      if (!communityListWithinByteCap(list, tombstones)) {
        console.warn("community list exceeds the NIP-44 byte cap; not publishing");
        return;
      }
      const plaintext = JSON.stringify({ entries: list, tombstones });
      const content = await this.signer.nip44.encrypt(this.pubkey, plaintext);
      const signed = await this.signer.signEvent({
        kind: COMMUNITY_LIST_KIND,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });
      // Prime the plaintext BEFORE adding: `eventStore.add` notifies subscribers synchronously,
      // so the exposed cast (and the auto-unlock path) must already see this event as unlocked —
      // otherwise auto-unlock would re-issue a redundant user-signer decrypt of a list we just wrote.
      setHiddenContentCache(signed, plaintext);
      this.eventStore.add(signed);
      this.pool.publish(this.defaultRelays, signed).catch((err) => console.warn("list publish failed", err));
      // Record what we just put on the relay so an immediate re-save (or the echo) is a no-op.
      this.publishedListFingerprint = fingerprint;
    } catch (err) {
      console.warn("failed to save community list", err);
    }
  }
}
