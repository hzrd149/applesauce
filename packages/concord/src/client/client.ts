// ConcordClient — the thin multi-community manager.
//
// Owns the per-user Community List (kind 13302), the shared RelayPool / NIP-42
// authenticator / wrap-level EventStore, and a Map of single-community
// `ConcordCommunity` engines. It carries no community logic itself: joining,
// syncing, folding, and publishing all live in `ConcordCommunity`. One instance
// per logged-in user.

import { BehaviorSubject, Subscription, firstValueFrom, timeout, toArray } from "rxjs";
import { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers/event";
import {
  getHiddenContent,
  isHiddenContentUnlocked,
  setHiddenContentCache,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";

import { ConcordRelayAuth } from "./relay-auth.js";
import { defaultKeyStorage, type ConcordKeyStorage, type ConcordUploader } from "./storage.js";
import { createCommunity } from "../helpers/community.js";
import {
  COMMUNITY_LIST_KIND,
  communityListWithinByteCap,
  isCommunityLive,
  mergeCommunities,
  mergeCommunityTombstones,
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
import { joinCommunity, leaveCommunity, refreshCommunity } from "../operations/community-list.js";
import { JoinLeaveFactory } from "../factories/guestbook.js";
import type {
  CommunityListCommunity,
  CommunityState,
  CommunityTombstone,
  JoinMaterial,
} from "../types.js";
import { ConcordCommunity } from "./community.js";
import type { ConcordClientOptions, ConcordStoreFactory } from "./types.js";

export class ConcordClient {
  readonly signer: ISigner;
  readonly pubkey: string;
  /** Every joined community's current folded state. */
  readonly communities$ = new BehaviorSubject<CommunityState[]>([]);
  readonly status$ = new BehaviorSubject<string>("");

  private readonly pool: RelayPool;
  private readonly eventStore: EventStore;
  private readonly storage: ConcordKeyStorage;
  private readonly uploader?: ConcordUploader;
  private readonly defaultRelays: string[];
  private readonly storeFactory?: ConcordStoreFactory;
  private readonly relayAuth: ConcordRelayAuth;

  private readonly communities = new Map<string, ConcordCommunity>();
  private readonly stateSubs = new Map<string, Subscription>();
  /** The authoritative 13302 document (CORD-02 §8): two merged, never-clobbered arrays. */
  private list: CommunityListCommunity[] = [];
  private tombstones: CommunityTombstone[] = [];
  private authSub?: Subscription;
  private started = false;

  constructor(options: ConcordClientOptions) {
    this.signer = options.signer;
    this.pubkey = options.pubkey;
    this.pool = options.pool;
    this.eventStore = options.eventStore ?? new EventStore();
    this.storage = options.storage ?? defaultKeyStorage();
    this.uploader = options.uploader;
    this.defaultRelays = options.relays?.length ? options.relays : STOCK_RELAYS;
    this.storeFactory = options.storeFactory;
    this.relayAuth = new ConcordRelayAuth(options.pool);
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
    await this.loadCommunityList();
  }

  stop(): void {
    this.authSub?.unsubscribe();
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
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
        .pipe(toArray(), timeout(10000)),
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
      storeFactory: this.storeFactory ? (_cid, planeKey) => this.storeFactory!(material.community_id, planeKey) : undefined,
      onMaterialChange: () => {
        void this.saveMaterials();
        void this.saveCommunityList();
      },
      onRemoved: (removed) => this.handleRemoved(removed),
    });
    this.communities.set(material.community_id, community);
    this.stateSubs.set(material.community_id, community.state$.subscribe(() => this.emitCommunities()));
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

  private async loadCommunityList(): Promise<void> {
    try {
      const events = await firstValueFrom(
        this.pool
          .request(this.defaultRelays, [{ kinds: [COMMUNITY_LIST_KIND], authors: [this.pubkey] }])
          .pipe(toArray(), timeout(8000)),
      ).catch(() => [] as NostrEvent[]);
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!newest || !this.signer.nip44) return;
      this.eventStore.add(newest);
      const latest = this.eventStore.getReplaceable(COMMUNITY_LIST_KIND, this.pubkey) ?? newest;
      if (!isHiddenContentUnlocked(latest)) await unlockHiddenContent(latest, this.signer);
      const json = getHiddenContent(latest);
      if (!json) return;
      const remote = JSON.parse(json) as { entries?: CommunityListCommunity[]; tombstones?: CommunityTombstone[] };
      // Merge into our arrays rather than replace (CORD-02 §8).
      this.list = mergeCommunities(this.list, remote.entries ?? []);
      this.tombstones = mergeCommunityTombstones(this.tombstones, remote.tombstones ?? []);
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
    } catch (err) {
      console.warn("failed to load community list", err);
    }
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
          list = joinCommunity({ ...existing, current: community.material, added_at: nowMs })(list, tombstones).communities;
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
      this.eventStore.add(signed);
      const stored = this.eventStore.getReplaceable(COMMUNITY_LIST_KIND, this.pubkey) ?? signed;
      setHiddenContentCache(stored, plaintext);
      this.pool.publish(this.defaultRelays, signed).catch((err) => console.warn("list publish failed", err));
    } catch (err) {
      console.warn("failed to save community list", err);
    }
  }
}
