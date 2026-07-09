// ConcordClient — the thin multi-community manager.
//
// Owns the per-user Community List (kind 13302), the shared RelayPool / NIP-42
// authenticator / wrap-level EventStore, and a Map of single-community
// `ConcordCommunity` engines. It carries no community logic itself: joining,
// syncing, folding, and publishing all live in `ConcordCommunity`. One instance
// per logged-in user.

import { BehaviorSubject, Observable, Subscription, firstValueFrom, map, of, switchMap, timeout, toArray } from "rxjs";
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
import type { CommunityListCommunity, CommunityState, CommunityTombstone, JoinMaterial } from "../types.js";
import { ConcordCommunity } from "./community.js";

/** Options for constructing the multi-community {@link ConcordClient} manager. */
export interface ConcordClientOptions {
  /** The logged-in user's signer. */
  signer: ISigner;
  /** The logged-in user's hex pubkey. */
  pubkey: string;
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
  readonly pubkey: string;
  /** Every joined community's current folded state. */
  readonly communities$ = new BehaviorSubject<CommunityState[]>([]);
  readonly status$ = new BehaviorSubject<string>("");

  private readonly pool: RelayPool;
  private readonly eventStore: EventStore;
  private readonly storage: ConcordStorage;
  private readonly uploader?: ConcordUploader;
  private readonly defaultRelays: string[];
  private readonly storeFactory?: ConcordStoreFactory;
  private readonly relayAuth: ConcordRelayAuth;
  private readonly autoUnlock: boolean;
  /** The logged-in user as a cast over the shared event store — the source of the exposed
   *  `communityList$` / `inviteList$` observables. */
  private readonly user: User;

  private readonly communities = new Map<string, ConcordCommunity>();
  private readonly stateSubs = new Map<string, Subscription>();
  /** The authoritative 13302 document (CORD-02 §8): two merged, never-clobbered arrays. */
  private list: CommunityListCommunity[] = [];
  private tombstones: CommunityTombstone[] = [];
  private authSub?: Subscription;
  private listSub?: Subscription;
  private inviteSub?: Subscription;
  /** List event ids we've already auto-unlocked — the cast re-emits several times per event
   *  (outbox/replaceable churn), so we prompt the user's signer at most once per event id. */
  private readonly autoUnlocked = new Set<string>();
  private started = false;

  constructor(options: ConcordClientOptions) {
    this.signer = options.signer;
    this.pubkey = options.pubkey;
    this.pool = options.pool;
    this.eventStore = options.eventStore ?? new EventStore();
    this.storage = options.storage ?? defaultStorage();
    this.uploader = options.uploader;
    this.defaultRelays = options.relays?.length ? options.relays : STOCK_RELAYS;
    this.storeFactory = options.storeFactory;
    this.autoUnlock = options.autoUnlock ?? false;
    this.relayAuth = new ConcordRelayAuth(options.pool);
    this.user = castUser(this.pubkey, this.eventStore);
  }

  /** The user's Community List (kind 13302) as a reactive cast — `undefined` until the event
   *  lands in the store; locked until `autoUnlock` or the app calls `.unlock(signer)`. */
  get communityList$(): Observable<ConcordCommunityList | undefined> {
    return this.user.concordCommunityList$;
  }

  /** The user's Invite List (kind 13303) as a reactive cast — same lock/unlock semantics. */
  get inviteList$(): Observable<ConcordInviteList | undefined> {
    return this.user.concordInviteList$;
  }

  // ---- lifecycle ----------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Answer NIP-42 challenges from community relays so they serve our events.
    this.authSub = this.relayAuth.autoAuthenticate(this.signer, this.pubkey);
    // Restore memberships from the local mirror first (instant, offline-safe),
    // then reconcile with the relay-published Community List (kind 13302).
    for (const material of await this.loadMaterials()) {
      if (!this.communities.has(material.community_id)) this.addCommunity(material);
    }
    this.watchLists();
    // Pull the user's self-encrypted lists into the store; the cast subscriptions above pick
    // them up (and auto-unlock / reconcile) as they arrive.
    void this.fetchList(COMMUNITY_LIST_KIND);
    void this.fetchList(INVITE_LIST_KIND);
  }

  stop(): void {
    this.authSub?.unsubscribe();
    this.listSub?.unsubscribe();
    this.inviteSub?.unsubscribe();
    for (const sub of this.stateSubs.values()) sub.unsubscribe();
    this.stateSubs.clear();
    for (const community of this.communities.values()) community.dispose();
    this.communities.clear();
    this.communities$.next([]);
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

  async joinByLink(url: string): Promise<string> {
    this.status$.next("Fetching invite…");
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
      held_roots: bundle.held_roots,
      refounder: bundle.refounder,
    };

    if (this.communities.has(material.community_id)) return material.community_id;

    const community = this.addCommunity(material);
    await this.saveMaterials();
    // Publish our Join (with attribution, CORD-05).
    const joinRumor = await JoinLeaveFactory.create("join", {
      invite: bundle.creator_npub ? { creator: bundle.creator_npub, label: bundle.label } : undefined,
    });
    await community.publishToPlane({ plane: "guestbook" }, joinRumor, {});
    await this.saveCommunityList();
    this.status$.next("");
    return material.community_id;
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
        void this.saveCommunityList();
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
    this.listSub = this.user.concordCommunityList$
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
        void this.reconcileCommunities();
      });

    // Nothing consumes the Invite List yet — just auto-unlock it so the exposed cast is
    // populated for the app when `autoUnlock` is on.
    this.inviteSub = this.user.concordInviteList$.subscribe((cast) => {
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

  private async saveCommunityList(): Promise<void> {
    if (!this.signer.nip44) return;
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
    } catch (err) {
      console.warn("failed to save community list", err);
    }
  }
}
