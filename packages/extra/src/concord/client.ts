// ConcordClient — the reactive engine.
//
// Uses applesauce (EventStore + RelayPool) for all Nostr I/O, and the Concord
// protocol layer (crypto/stream/control/guestbook/invite) to fold plane events
// into reactive community state. One instance per logged-in user.

import { BehaviorSubject, Subscription, firstValueFrom, timeout, toArray } from "rxjs";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools";
import type { NostrEvent } from "nostr-tools";

import type { IEventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import {
  getEncryptedContent,
  isEncryptedContentUnlocked,
  setEncryptedContentCache,
  unlockEncryptedContent,
} from "applesauce-core/helpers";
import { getReactionEmoji } from "applesauce-common/helpers";
import { fromHex, toHex, ZERO_32 } from "./bytes.js";
import { parseImeta, type MediaAttachment } from "./operations/imeta.js";
import {
  banlistLocator,
  baseRekeyGroupKey,
  controlGroupKey,
  dissolvedGroupKey,
  epochKeyCommitment,
  grantLocator,
  guestbookGroupKey,
  inviteLinksLocator,
} from "./helpers/crypto.js";
import {
  base64ToBytes,
  buildRekeyRumors,
  bytesToBase64,
  checkContinuity,
  decodeWrappedKey,
  encodeWrappedKey,
  findBlob,
  groupRotations,
  lowerKeyWins,
  parseRekey,
  rekeyLocator,
  ROOT_SCOPE_HEX,
} from "./helpers/rekey.js";
import { createStreamEvent, decodeStreamEventCached, rewrapSeal } from "./stream.js";
import { MAX_CHANNEL_CACHE, defaultKeyStorage, memoryStorage } from "./storage.js";
import type { CachedEntry, ConcordKeyStorage, ConcordStorage, ConcordUploader } from "./storage.js";
import { ConcordRelayAuth } from "./relay-auth.js";
import { foldControl } from "./helpers/control.js";
import {
  addToList,
  isCommunityLive,
  mergeCommunityLists,
  refreshCurrent,
  removeFromList,
  withinByteCap,
} from "./helpers/community-list.js";
import type { CommunityList } from "./helpers/community-list.js";
import { buildSnapshotRumors, foldMembers } from "./helpers/guestbook.js";
import { resolveStanding, canActOn, hasPerm } from "./helpers/permissions.js";
import type { Standing } from "./helpers/permissions.js";
import { createCommunity, deriveKeys, verifyOwner } from "./helpers/community.js";
import type { CommunityKeys } from "./helpers/community.js";
import { buildEdition, computeEditionHash } from "./helpers/editions.js";
import {
  messageRumor,
  reactionRumor,
  deleteRumor,
  editRumor,
  checkChatBinding,
  type Emoji,
} from "./operations/chat.js";
import {
  buildBundleEventTemplate,
  buildInviteLink,
  decryptBundle,
  newInviteToken,
  parseInviteLink,
  STOCK_RELAYS,
} from "./operations/invite.js";
import type { GroupKey } from "./helpers/crypto.js";
import {
  KIND,
  PERM,
  VSK,
  type BlobPointer,
  type CommunityMetadata,
  type CommunityState,
  type DecodedEvent,
  type InviteBundle,
  type JoinMaterial,
  type Role,
} from "./types.js";

/** Options for constructing a {@link ConcordClient}. One instance per account. */
export interface ConcordClientOptions {
  /** The logged-in user's signer (NIP-44 support is required for private
   *  channels, the encrypted Community List, and CORD-06 refoundings). */
  signer: ISigner;
  /** The logged-in user's hex pubkey. */
  pubkey: string;
  /** The applesauce EventStore used for dedup + the encrypted-content cache. */
  eventStore: IEventStore;
  /** The applesauce RelayPool used for all subscriptions/publishes. */
  pool: RelayPool;
  /** Persistence for the membership/key material mirror. The key is the user's
   *  pubkey, so consuming apps can namespace/prefix externally if needed. */
  storage?: ConcordKeyStorage;
  /** Temporary persistence for the decoded-rumor cache. Defaults to memory. */
  cacheStorage?: ConcordStorage;
  /** Media uploader (encrypt + upload). Required to send files or set community
   *  images; omit if the client never uploads media. */
  uploader?: ConcordUploader;
  /** Fallback relays when a community defines none. Defaults to the CORD-05
   *  stock relay set. */
  relays?: string[];
}

export interface ChatMessage {
  id: string;
  author: string;
  content: string;
  ms: number;
  edited?: string;
  deleted: boolean;
  replyTo?: { id: string; author: string };
  /** `emoji` is the reaction content (a unicode char or `:shortcode:`); `url` is set for NIP-30 custom emoji. */
  reactions: { emoji: string; url?: string; count: number; authors: string[] }[];
  /** Encrypted media/files parsed from the message's NIP-92 imeta tags. */
  attachments: MediaAttachment[];
  /** The message's NIP-30 `["emoji", …]` tags, for rendering `:shortcode:` inline. */
  emojiTags: string[][];
  /** The decoded plane event (rumor + wrapper metadata), retained for debugging ("view raw"). */
  raw: DecodedEvent;
}

interface PlaneInfo {
  type: "control" | "guestbook" | "channel" | "dissolved" | "rekey";
  convKey: Uint8Array;
  channelId?: string;
  epoch?: number;
}

interface Runtime {
  material: JoinMaterial;
  keys: CommunityKeys;
  controlEvents: Map<string, DecodedEvent>;
  guestbookEvents: Map<string, DecodedEvent>;
  channelEvents: Map<string, Map<string, DecodedEvent>>;
  observed: Map<string, number>;
  planeMap: Map<string, PlaneInfo>;
  dissolved: boolean;
  /** CORD-06 rekey blobs seen at the next-epoch base-rekey address. */
  rekeyEvents: Map<string, DecodedEvent>;
  /** Guard: adopt/tombstone at most once per target epoch. */
  rekeyHandled: Set<number>;
  rekeyTimer?: ReturnType<typeof setTimeout>;
  /** stable subscription: control + guestbook + dissolved planes */
  controlSub?: Subscription;
  /** dynamic subscription: channel planes (reopened when the set changes) */
  channelSub?: Subscription;
  /** signature of the current channel author set, to avoid needless resubs */
  channelAuthors: string;
  state$: BehaviorSubject<CommunityState>;
  messages$: Map<string, BehaviorSubject<ChatMessage[]>>;
  refoldTimer?: ReturnType<typeof setTimeout>;
  persistTimer?: ReturnType<typeof setTimeout>;
}

function emptyState(material: JoinMaterial): CommunityState {
  return {
    material,
    channels: [],
    roles: [],
    grants: new Map(),
    banlist: new Set(),
    members: new Set(),
    dissolved: false,
  };
}

export class ConcordClient {
  readonly signer: ISigner;
  readonly pubkey: string;
  readonly communities$ = new BehaviorSubject<CommunityState[]>([]);
  readonly status$ = new BehaviorSubject<string>("");
  private readonly eventStore: IEventStore;
  private readonly pool: RelayPool;
  private readonly storage: ConcordKeyStorage;
  private readonly cacheStorage: ConcordStorage;
  private readonly uploader?: ConcordUploader;
  private readonly defaultRelays: string[];
  private readonly relayAuth: ConcordRelayAuth;
  private runtimes = new Map<string, Runtime>();
  /** The authoritative 13302 document (CORD-02 §8): merged, never clobbered. */
  private communityList: CommunityList = { entries: [], tombstones: [] };

  constructor(options: ConcordClientOptions) {
    this.signer = options.signer;
    this.pubkey = options.pubkey;
    this.eventStore = options.eventStore;
    this.pool = options.pool;
    this.storage = options.storage ?? defaultKeyStorage();
    this.cacheStorage = options.cacheStorage ?? memoryStorage();
    this.uploader = options.uploader;
    this.defaultRelays = options.relays?.length ? options.relays : STOCK_RELAYS;
    this.relayAuth = new ConcordRelayAuth(options.pool);
  }

  // ---- lifecycle ----------------------------------------------------------

  private started = false;
  private authSub?: Subscription;

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Answer NIP-42 challenges from community relays so they serve our events.
    this.authSub = this.relayAuth.autoAuthenticate(this.signer, this.pubkey);
    // Restore memberships from the local mirror first (instant, offline-safe),
    // then reconcile with the relay-published Community List (kind 13302).
    for (const m of await this.loadMaterials()) {
      if (!this.runtimes.has(m.community_id)) this.addRuntime(m);
    }
    await this.loadCommunityList();
  }

  private materialsKey(): string {
    return this.pubkey;
  }

  private async loadMaterials(): Promise<JoinMaterial[]> {
    try {
      const raw = await this.storage.getItem(this.materialsKey());
      return raw ? (JSON.parse(raw) as JoinMaterial[]) : [];
    } catch {
      return [];
    }
  }

  private async saveMaterials(): Promise<void> {
    try {
      const mats = [...this.runtimes.values()].map((r) => r.material);
      await this.storage.setItem(this.materialsKey(), JSON.stringify(mats));
    } catch (err) {
      console.warn("failed to mirror communities locally", err);
    }
  }

  // ---- decoded-rumor cache (over the injected storage) --------------------

  private cacheKey(cid: string): string {
    return `concord:cache:${cid}`;
  }

  private loadCache(cid: string): CachedEntry[] {
    try {
      const raw = this.cacheStorage.getItem(this.cacheKey(cid));
      if (!raw) return [];
      const parsed = JSON.parse(raw) as { events?: CachedEntry[] };
      return Array.isArray(parsed.events) ? parsed.events : [];
    } catch {
      return [];
    }
  }

  private saveCache(cid: string, entries: CachedEntry[]): void {
    try {
      this.cacheStorage.setItem(this.cacheKey(cid), JSON.stringify({ v: 1, events: entries }));
    } catch (err) {
      console.warn("concord cache write failed", err);
    }
  }

  private clearCache(cid: string): void {
    try {
      this.cacheStorage.removeItem(this.cacheKey(cid));
    } catch {
      /* ignore */
    }
  }

  stop(): void {
    this.authSub?.unsubscribe();
    for (const rt of this.runtimes.values()) {
      rt.controlSub?.unsubscribe();
      rt.channelSub?.unsubscribe();
      if (rt.persistTimer) {
        clearTimeout(rt.persistTimer);
        this.persistCache(rt); // flush any pending cache write before teardown
      }
    }
    this.runtimes.clear();
    this.communities$.next([]);
  }

  getState$(cid: string): BehaviorSubject<CommunityState> | undefined {
    return this.runtimes.get(cid)?.state$;
  }

  getMessages$(cid: string, channelId: string): BehaviorSubject<ChatMessage[]> {
    const rt = this.runtimes.get(cid)!;
    let subj = rt.messages$.get(channelId);
    if (!subj) {
      subj = new BehaviorSubject<ChatMessage[]>([]);
      rt.messages$.set(channelId, subj);
      this.recomputeMessages(rt, channelId);
    }
    return subj;
  }

  // ---- creating / joining -------------------------------------------------

  async createNewCommunity(name: string, description: string, relays: string[]): Promise<string> {
    const genesis = createCommunity({
      ownerPubkey: this.pubkey,
      name,
      description,
      relays: relays.length ? relays : this.defaultRelays,
    });
    const rt = this.addRuntime(genesis.material);
    await this.saveMaterials();
    // Publish genesis control editions (plaintext seal) + owner Join.
    for (const rumor of genesis.controlRumors) {
      await this.publishToPlane(rt, rt.keys.control, rumor, { plaintext: true });
    }
    for (const rumor of genesis.guestbookRumors) {
      await this.publishToPlane(rt, rt.keys.guestbook, rumor, {});
    }
    await this.saveCommunityList();
    return genesis.material.community_id;
  }

  async joinByLink(url: string): Promise<string> {
    this.status$.next("Fetching invite…");
    const parsed = parseInviteLink(url);
    const relays = parsed.bootstrapRelays.length ? parsed.bootstrapRelays : this.defaultRelays;
    const events = await firstValueFrom(
      this.pool
        .request(relays, [{ kinds: [KIND.INVITE_BUNDLE], authors: [parsed.linkSigner] }])
        .pipe(toArray(), timeout(10000)),
    ).catch(() => [] as NostrEvent[]);

    const live = events
      .filter((e) => (e.tags.find((t) => t[0] === "vsk")?.[1] ?? "6") === "6")
      .sort((a, b) => b.created_at - a.created_at)[0];
    if (!live) throw new Error("invite bundle not found or revoked");

    const bundle: InviteBundle = decryptBundle(live.content, parsed.token);
    const material: JoinMaterial = {
      community_id: bundle.community_id,
      owner: bundle.owner,
      owner_salt: bundle.owner_salt,
      community_root: bundle.community_root,
      root_epoch: bundle.root_epoch,
      channels: bundle.channels ?? [],
      relays: bundle.relays ?? relays,
      name: bundle.name,
    };
    if (!verifyOwner(material)) throw new Error("invite failed owner verification");
    if (bundle.expires_at && Date.now() > bundle.expires_at) throw new Error("invite expired");

    if (this.runtimes.has(material.community_id)) return material.community_id;

    const rt = this.addRuntime(material);
    await this.saveMaterials();
    // Publish our Join (with attribution, CORD-05).
    const joinTags: string[][] = [["ms", String(Date.now() % 1000)]];
    if (bundle.creator_npub) joinTags.push(["invite", bundle.creator_npub, bundle.label ?? ""]);
    await this.publishToPlane(rt, rt.keys.guestbook, { kind: KIND.JOIN_LEAVE, content: "join", tags: joinTags }, {});
    await this.saveCommunityList();
    this.status$.next("");
    return material.community_id;
  }

  // ---- chat actions -------------------------------------------------------

  private channelKey(rt: Runtime, channelId: string): GroupKey {
    const key = rt.keys.channels.get(channelId);
    if (!key) throw new Error("unknown channel");
    return key;
  }

  private channelEpoch(rt: Runtime, channelId: string): number {
    const ch = rt.state$.value.channels.find((c) => c.channel_id === channelId);
    return ch?.private ? ch.epoch ?? 1 : rt.material.root_epoch;
  }

  async sendMessage(
    cid: string,
    channelId: string,
    text: string,
    replyTo?: { id: string; author: string },
    files?: Blob[],
    emojis?: Emoji[],
  ): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    // Encrypt + upload each file via the injected uploader, appending its URL to
    // the content and its NIP-92 imeta attachment (per-file decryption key).
    let content = text;
    let attachments: MediaAttachment[] | undefined;
    if (files?.length) {
      if (!this.uploader) throw new Error("no uploader configured: cannot send file attachments");
      attachments = [];
      for (const file of files) {
        const attachment = await this.uploader.upload(file, cid);
        attachments.push(attachment);
        content = content ? `${content}\n${attachment.url}` : attachment.url;
      }
    }
    await this.publishToPlane(
      rt,
      this.channelKey(rt, channelId),
      messageRumor(channelId, epoch, content, replyTo, attachments, emojis),
      {},
    );
  }

  async react(
    cid: string,
    channelId: string,
    target: { id: string; author: string },
    reaction: string | Emoji,
  ): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    await this.publishToPlane(
      rt,
      this.channelKey(rt, channelId),
      reactionRumor(channelId, epoch, { ...target, kind: KIND.MESSAGE }, reaction),
      {},
    );
  }

  async editMessage(cid: string, channelId: string, targetId: string, text: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    await this.publishToPlane(rt, this.channelKey(rt, channelId), editRumor(channelId, epoch, targetId, text), {});
  }

  async deleteMessage(cid: string, channelId: string, targetId: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    await this.publishToPlane(rt, this.channelKey(rt, channelId), deleteRumor(channelId, epoch, targetId), {});
  }

  // ---- admin actions ------------------------------------------------------

  private buildVac(rt: Runtime, actor: string): [string, string, string] | undefined {
    if (actor === rt.material.owner) return undefined;
    const eid = grantLocator(fromHex(rt.material.community_id), actor);
    const latest = this.latestEdition(rt, eid);
    if (!latest) return undefined;
    return [eid, String(latest.version), latest.hash];
  }

  private latestEdition(rt: Runtime, eid: string): { version: number; hash: string; content: string } | undefined {
    let best: { version: number; hash: string; content: string } | undefined;
    for (const d of rt.controlEvents.values()) {
      const r = d.rumor;
      if (r.tags.find((t) => t[0] === "eid")?.[1] !== eid) continue;
      const version = parseInt(r.tags.find((t) => t[0] === "ev")?.[1] ?? "1", 10);
      if (!best || version > best.version) {
        const prev = r.tags.find((t) => t[0] === "ep")?.[1];
        const hash = computeEditionHash({ vsk: 0, eid, version, prevHash: prev, content: r.content });
        best = { version, hash, content: r.content };
      }
    }
    return best;
  }

  private async publishEdition(rt: Runtime, vsk: number, eid: string, content: string): Promise<void> {
    const latest = this.latestEdition(rt, eid);
    const version = latest ? latest.version + 1 : 1;
    const vac = this.buildVac(rt, this.pubkey);
    const rumor = buildEdition({ vsk, eid, version, prevHash: latest?.hash, content, vac });
    await this.publishToPlane(rt, rt.keys.control, rumor, { plaintext: true });
  }

  async editMetadata(cid: string, patch: Partial<CommunityMetadata>): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const current = rt.state$.value.metadata ?? { name: rt.material.name, relays: rt.material.relays };
    const next: CommunityMetadata = { ...current, ...patch };
    await this.publishEdition(rt, VSK.METADATA, rt.material.community_id, JSON.stringify(next));
  }

  /**
   * Encrypt an image via the injected uploader and publish the resulting
   * {@link BlobPointer} into the community metadata as the icon or banner
   * (CORD-02 §6). The plaintext never leaves the device.
   */
  async setCommunityImage(cid: string, which: "icon" | "banner", file: Blob): Promise<void> {
    if (!this.uploader) throw new Error("no uploader configured: cannot set community image");
    const att = await this.uploader.upload(file, cid);
    if (!att.encryption || !att.originalHash) throw new Error("uploader did not return an encrypted attachment");
    const pointer: BlobPointer = {
      url: att.url,
      key: att.encryption.key,
      nonce: att.encryption.nonce,
      hash: att.originalHash,
    };
    await this.editMetadata(cid, { [which]: pointer });
  }

  /** Clear the community icon or banner. */
  async removeCommunityImage(cid: string, which: "icon" | "banner"): Promise<void> {
    await this.editMetadata(cid, { [which]: undefined });
  }

  async createChannel(cid: string, name: string, isPrivate: boolean, voice = false): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const channelId = toHex(generateSecretKey());
    if (isPrivate) {
      // A private channel mints its own key; grant-holders get it in invites.
      const key = toHex(generateSecretKey());
      rt.material.channels.push({ id: channelId, key, epoch: 1, name });
      // Persist the key both locally and into our Community List (13302), or it
      // is lost on reload.
      await this.saveMaterials();
      await this.saveCommunityList();
    }
    const content: Record<string, unknown> = { name, private: isPrivate };
    if (voice) content.voice = true;
    await this.publishEdition(rt, VSK.CHANNEL, channelId, JSON.stringify(content));
  }

  async deleteChannel(cid: string, channelId: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const ch = rt.state$.value.channels.find((c) => c.channel_id === channelId);
    if (!ch) return;
    await this.publishEdition(rt, VSK.CHANNEL, channelId, JSON.stringify({ name: ch.name, private: ch.private, deleted: true }));
  }

  async createRole(cid: string, name: string, position: number, permissions: bigint): Promise<string> {
    const rt = this.runtimes.get(cid)!;
    const roleId = toHex(generateSecretKey());
    const role: Role = {
      role_id: roleId,
      name,
      position,
      permissions: permissions.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    await this.publishEdition(rt, VSK.ROLE, roleId, JSON.stringify(role));
    return roleId;
  }

  async grantRoles(cid: string, member: string, roleIds: string[]): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const eid = grantLocator(fromHex(rt.material.community_id), member);
    await this.publishEdition(rt, VSK.GRANT, eid, JSON.stringify({ member, role_ids: roleIds }));
  }

  async kick(cid: string, member: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    // Strip roles first, then the cooperative Kick directive (CORD-04 §6).
    await this.grantRoles(cid, member, []);
    const vac = this.buildVac(rt, this.pubkey);
    const tags: string[][] = [["ms", String(Date.now() % 1000)], ["p", member]];
    if (vac) tags.push(["vac", ...vac]);
    await this.publishToPlane(rt, rt.keys.guestbook, { kind: KIND.KICK, content: "", tags }, {});
  }

  async ban(cid: string, member: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const current = new Set(rt.state$.value.banlist);
    current.add(member);
    const eid = banlistLocator(fromHex(rt.material.community_id));
    await this.publishEdition(rt, VSK.BANLIST, eid, JSON.stringify([...current]));
    await this.grantRoles(cid, member, []);
    // NOTE: full enforcement also requires a Refounding (rekey) — CORD-06.
  }

  async unban(cid: string, member: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const current = new Set(rt.state$.value.banlist);
    current.delete(member);
    const eid = banlistLocator(fromHex(rt.material.community_id));
    await this.publishEdition(rt, VSK.BANLIST, eid, JSON.stringify([...current]));
  }

  async dissolve(cid: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    if (this.pubkey !== rt.material.owner) throw new Error("only the owner can dissolve");
    const key = dissolvedGroupKey(fromHex(rt.material.community_id));
    await this.publishToPlane(
      rt,
      key,
      { kind: KIND.CONTROL, content: "", tags: [["vsk", "10"], ["eid", "00".repeat(32)]] },
      { plaintext: true },
    );
  }

  async leave(cid: string): Promise<void> {
    const rt = this.runtimes.get(cid);
    if (!rt) return;
    await this.publishToPlane(
      rt,
      rt.keys.guestbook,
      { kind: KIND.JOIN_LEAVE, content: "leave", tags: [["ms", String(Date.now() % 1000)]] },
      {},
    );
    rt.controlSub?.unsubscribe();
    rt.channelSub?.unsubscribe();
    if (rt.persistTimer) clearTimeout(rt.persistTimer);
    this.clearCache(cid);
    this.runtimes.delete(cid);
    // Tombstone the membership so the leave propagates across devices/clients
    // (a bare omission would merge back as still-joined — CORD-02 §8).
    this.communityList = removeFromList(this.communityList, cid, Date.now());
    await this.saveMaterials();
    this.emitCommunities();
    await this.saveCommunityList();
  }

  // ---- invites ------------------------------------------------------------

  async createInvite(cid: string, base: string): Promise<string> {
    const rt = this.runtimes.get(cid)!;
    const token = newInviteToken();
    const linkSk = generateSecretKey();
    const linkPub = getPublicKey(linkSk);

    const state = rt.state$.value;
    // Include private-channel keys the inviter holds so the joiner can read them.
    const channels = rt.material.channels.map((c) => ({ id: c.id, key: c.key, epoch: c.epoch, name: c.name }));

    const bundle: InviteBundle = {
      community_id: rt.material.community_id,
      owner: rt.material.owner,
      owner_salt: rt.material.owner_salt,
      community_root: rt.material.community_root,
      root_epoch: rt.material.root_epoch,
      channels,
      relays: rt.material.relays,
      name: state.metadata?.name ?? rt.material.name,
      icon: state.metadata?.icon,
      creator_npub: this.pubkey,
    };

    const template = buildBundleEventTemplate(bundle, token);
    const signed = finalizeEvent(template, linkSk);
    this.eventStore.add(signed);
    const inviteRelays = rt.material.relays.length ? rt.material.relays : this.defaultRelays;
    this.pool.publish(inviteRelays, signed).catch((err) => console.warn("bundle publish failed", err));

    // Register the link into the community (CORD-05 §5) so it counts as Public.
    const registryEid = inviteLinksLocator(fromHex(rt.material.community_id), this.pubkey);
    const existing = this.latestEdition(rt, registryEid);
    let links: string[] = [];
    try {
      if (existing) links = JSON.parse(existing.content) as string[];
    } catch { /* ignore */ }
    if (!links.includes(linkPub)) links.push(linkPub);
    await this.publishEdition(rt, VSK.INVITE_REGISTRY, registryEid, JSON.stringify(links));

    return buildInviteLink(base, linkPub, token, rt.material.relays.length ? rt.material.relays : this.defaultRelays);
  }

  // ---- internal: runtime & subscriptions ----------------------------------

  private addRuntime(material: JoinMaterial): Runtime {
    const rt: Runtime = {
      material,
      keys: deriveKeys(material, []),
      controlEvents: new Map(),
      guestbookEvents: new Map(),
      channelEvents: new Map(),
      observed: new Map(),
      planeMap: new Map(),
      dissolved: false,
      rekeyEvents: new Map(),
      rekeyHandled: new Set(),
      channelAuthors: "",
      state$: new BehaviorSubject<CommunityState>(emptyState(material)),
      messages$: new Map(),
    };
    this.runtimes.set(material.community_id, rt);
    // Rehydrate from the local cache first, so channels/members are visible
    // immediately, then fold and open relay subscriptions to sync anything new.
    this.hydrate(rt);
    this.refold(rt);
    this.openControlSub(rt);
    this.reconcileChannelSub(rt);
    this.emitCommunities();
    return rt;
  }

  private relaysFor(rt: Runtime): string[] {
    return rt.material.relays.length ? rt.material.relays : this.defaultRelays;
  }

  /**
   * Subscribe to gift wraps (kind 1059/21059) authored by `authors` across the
   * community's relays. `waitForAuth: authors` holds each relay's REQ until EVERY
   * queried stream author is authenticated (NIP-42) on that connection and
   * re-issues it after a reconnect; `authenticateStreamKeys` drives that
   * authentication per relay. Wraps stream into `ingest`; the returned
   * Subscription tears every relay's REQ (and auth driver) down together.
   */
  private subscribeWraps(rt: Runtime, authors: string[]): Subscription {
    const relays = this.relaysFor(rt);
    const filters = [{ kinds: [KIND.WRAP, KIND.WRAP_EPHEMERAL], authors }];
    const sub = new Subscription();
    for (const url of relays) sub.add(this.relayAuth.authenticateStreamKeys(this.pool.relay(url)));
    sub.add(
      this.pool.subscription(relays, filters, { waitForAuth: authors }).subscribe((event) => {
        this.ingest(rt, event as NostrEvent);
      }),
    );
    return sub;
  }

  /** The control/guestbook/dissolved planes never change address within an
   * epoch, so this subscription is opened once and never torn down mid-sync. */
  private openControlSub(rt: Runtime): void {
    const control = rt.keys.control;
    const guestbook = rt.keys.guestbook;
    const dissolved = dissolvedGroupKey(fromHex(rt.material.community_id));
    rt.planeMap.set(control.pk, { type: "control", convKey: control.convKey });
    rt.planeMap.set(guestbook.pk, { type: "guestbook", convKey: guestbook.convKey });
    rt.planeMap.set(dissolved.pk, { type: "dissolved", convKey: dissolved.convKey });
    // The NEXT epoch's base-rekey address (CORD-06 §2): a Refounding publishes
    // the new community_root here, keyed by the PRIOR root, so every current
    // holder converges. Subscribe now so an armada refounding is picked up live.
    const nextEpoch = rt.material.root_epoch + 1;
    const nextBaseRekey = baseRekeyGroupKey(
      fromHex(rt.material.community_root),
      fromHex(rt.material.community_id),
      nextEpoch,
    );
    rt.planeMap.set(nextBaseRekey.pk, { type: "rekey", convKey: nextBaseRekey.convKey, epoch: nextEpoch });
    // Register the core stream keys so an auth-gating relay can be answered as
    // these derived addresses (NIP-42) before the REQ is served.
    this.relayAuth.registerStreamKeys([control, guestbook, dissolved, nextBaseRekey]);
    const authors = [control.pk, guestbook.pk, dissolved.pk, nextBaseRekey.pk];
    rt.controlSub?.unsubscribe();
    rt.controlSub = this.subscribeWraps(rt, authors);
  }

  /** Reopen the channel subscription only when the set of channel addresses
   * actually changes — so discovering a channel never disturbs the control
   * subscription (which was the source of a mid-sync teardown race). */
  private reconcileChannelSub(rt: Runtime): void {
    for (const [channelId, key] of rt.keys.channels) {
      // Record the epoch this key derives at, so the receive-side binding check
      // (CORD-03 §44) can strict-compare the rumor's `epoch` tag against the
      // epoch whose key actually decrypted the wrap.
      rt.planeMap.set(key.pk, { type: "channel", convKey: key.convKey, channelId, epoch: this.channelEpoch(rt, channelId) });
    }
    // Register channel stream keys so the channel REQ can pass an auth gate.
    this.relayAuth.registerStreamKeys([...rt.keys.channels.values()]);
    const authors = [...rt.keys.channels.values()].map((k) => k.pk).sort();
    const sig = authors.join(",");
    if (sig === rt.channelAuthors) return;
    rt.channelAuthors = sig;
    rt.channelSub?.unsubscribe();
    if (authors.length === 0) return;
    rt.channelSub = this.subscribeWraps(rt, authors);
  }

  /** True when this wrap has already been folded into the plane it belongs to,
   * so a relay re-serving it (reload, reconnect, our own publish echoed back, an
   * overlapping subscription) needn't be decrypted or folded again. */
  private haveWrap(rt: Runtime, info: PlaneInfo, id: string): boolean {
    switch (info.type) {
      case "control":
        return rt.controlEvents.has(id);
      case "guestbook":
        return rt.guestbookEvents.has(id);
      case "channel":
        return rt.channelEvents.get(info.channelId!)?.has(id) ?? false;
      default:
        return false; // dissolved: a tiny, one-shot plane — let it fall through
    }
  }

  private ingest(rt: Runtime, event: NostrEvent): void {
    const info = rt.planeMap.get(event.pubkey);
    if (!info) return;
    // Cross-plane dedup (previously only control/guestbook were guarded, so
    // channel wraps were re-decrypted on every reload and every relay echo).
    if (event.kind !== KIND.WRAP_EPHEMERAL && this.haveWrap(rt, info, event.id)) return;
    // Add to the applesauce EventStore first: it dedups by id and hands back the
    // canonical instance, and decodeStreamEventCached memoises the decode on that
    // instance's symbol — so even paths that slip past haveWrap decrypt only once.
    const canonical = (this.eventStore.add(event) as NostrEvent | null) ?? event;
    const decoded = decodeStreamEventCached(canonical, info.convKey);
    if (!decoded) return;

    const prev = rt.observed.get(decoded.author) ?? 0;
    if (decoded.ms > prev) rt.observed.set(decoded.author, decoded.ms);

    switch (info.type) {
      case "control":
        rt.controlEvents.set(event.id, decoded);
        this.scheduleRefold(rt);
        this.schedulePersist(rt);
        break;
      case "guestbook":
        rt.guestbookEvents.set(event.id, decoded);
        this.scheduleRefold(rt);
        this.schedulePersist(rt);
        break;
      case "dissolved":
        if (decoded.author === rt.material.owner && decoded.rumor.tags.some((t) => t[0] === "vsk" && t[1] === "10")) {
          rt.dissolved = true;
          this.scheduleRefold(rt);
        }
        break;
      case "rekey":
        rt.rekeyEvents.set(event.id, decoded);
        this.scheduleRekeyCheck(rt);
        break;
      case "channel": {
        const channelId = info.channelId!;
        // CORD-03 §44: the receiver MUST check both `channel` and `epoch`
        // strict-equal against the channel/epoch whose key opened the wrap, and
        // drop any mismatch — this is the anti-replay guarantee (no member can
        // splice a rumor into another channel or replay it across an epoch).
        if (!checkChatBinding(decoded.rumor.tags, channelId, info.epoch ?? this.channelEpoch(rt, channelId))) {
          return;
        }
        // Voice presence (CORD-07 §4) rides the Channel's own address but is not
        // chat and voice is not handled by this client — drop it (never into the
        // message store or the persisted cache).
        if (decoded.rumor.kind === KIND.VOICE_PRESENCE) return;
        let ch = rt.channelEvents.get(channelId);
        if (!ch) {
          ch = new Map();
          rt.channelEvents.set(channelId, ch);
        }
        ch.set(event.id, decoded);
        this.recomputeMessages(rt, channelId);
        this.schedulePersist(rt);
        break;
      }
    }
  }

  // ---- local cache (survives reload independent of relay behaviour) --------

  private hydrate(rt: Runtime): void {
    for (const entry of this.loadCache(rt.material.community_id)) {
      const d = entry.decoded;
      if (entry.plane === "control") rt.controlEvents.set(d.wrapId, d);
      else if (entry.plane === "guestbook") rt.guestbookEvents.set(d.wrapId, d);
      else if (entry.plane === "channel" && entry.channelId) {
        let ch = rt.channelEvents.get(entry.channelId);
        if (!ch) {
          ch = new Map();
          rt.channelEvents.set(entry.channelId, ch);
        }
        ch.set(d.wrapId, d);
      }
      const prev = rt.observed.get(d.author) ?? 0;
      if (d.ms > prev) rt.observed.set(d.author, d.ms);
    }
  }

  private schedulePersist(rt: Runtime): void {
    if (rt.persistTimer) return;
    rt.persistTimer = setTimeout(() => {
      rt.persistTimer = undefined;
      this.persistCache(rt);
    }, 800);
  }

  private persistCache(rt: Runtime): void {
    const entries: CachedEntry[] = [];
    for (const d of rt.controlEvents.values()) entries.push({ plane: "control", decoded: d });
    for (const d of rt.guestbookEvents.values()) entries.push({ plane: "guestbook", decoded: d });
    for (const [channelId, m] of rt.channelEvents) {
      const recent = [...m.values()].sort((a, b) => a.ms - b.ms).slice(-MAX_CHANNEL_CACHE);
      for (const d of recent) entries.push({ plane: "channel", channelId, decoded: d });
    }
    this.saveCache(rt.material.community_id, entries);
  }

  private scheduleRefold(rt: Runtime): void {
    if (rt.refoldTimer) return;
    rt.refoldTimer = setTimeout(() => {
      rt.refoldTimer = undefined;
      this.refold(rt);
    }, 60);
  }

  private refold(rt: Runtime): void {
    const state = foldControl([...rt.controlEvents.values()], rt.material);
    rt.keys = deriveKeys(rt.material, state.channels);

    const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    const standing = (m: string): Standing => resolveStanding(m, rt.material.owner, rolesMap, state.grants);
    state.members = foldMembers([...rt.guestbookEvents.values()], rt.observed, state.banlist, standing);
    state.dissolved = rt.dissolved;

    rt.state$.next(state);
    this.reconcileChannelSub(rt); // pick up any newly-revealed channels
    // Recompute any open channel views (channel keys may have changed epoch).
    for (const channelId of rt.messages$.keys()) this.recomputeMessages(rt, channelId);
    this.emitCommunities();
  }

  private emitCommunities(): void {
    this.communities$.next([...this.runtimes.values()].map((r) => r.state$.value));
  }

  // ---- CORD-06 rekey read path (adopt a refounding or detect removal) ------

  private scheduleRekeyCheck(rt: Runtime): void {
    if (rt.rekeyTimer) return;
    rt.rekeyTimer = setTimeout(() => {
      rt.rekeyTimer = undefined;
      void this.checkRekey(rt);
    }, 200);
  }

  /**
   * Fold the rekey blobs at the next-epoch base-rekey address (CORD-06 §2/§3):
   * a complete, AUTHORIZED, continuity-checked root rotation carrying our blob
   * means adopt the new root (racing rotations converge on the lowest key); a
   * complete rotation with NO blob for us across all chunks means we've been
   * removed. Authority is the roster (owner or BAN), never key possession — a
   * removed member still holding the prior root can forge a perfect rotation.
   */
  private async checkRekey(rt: Runtime): Promise<void> {
    if (!this.signer.nip44) return;
    const heldEpoch = BigInt(rt.material.root_epoch);
    const heldKey = fromHex(rt.material.community_root);
    const state = rt.state$.value;
    const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    const authorized = (rotator: string): boolean => {
      if (rotator === rt.material.owner) return true;
      return hasPerm(resolveStanding(rotator, rt.material.owner, rolesMap, state.grants).permissions, PERM.BAN);
    };

    const parsed = [...rt.rekeyEvents.values()]
      .map((d) => parseRekey(d))
      .filter((p): p is NonNullable<typeof p> => p !== null);
    const rotations = groupRotations(parsed).filter(
      (set) =>
        set.scopeIdHex === ROOT_SCOPE_HEX &&
        set.newEpoch === heldEpoch + 1n &&
        authorized(set.rotator) &&
        checkContinuity(set, heldEpoch, heldKey).ok,
    );
    if (rotations.length === 0) return;

    const targetEpoch = rt.material.root_epoch + 1;
    if (rt.rekeyHandled.has(targetEpoch)) return;

    let adopted: { key: Uint8Array; rotator: string } | undefined;
    let sawComplete = false;
    for (const set of rotations) {
      if (!set.complete) continue;
      sawComplete = true;
      const blob = findBlob(set, rekeyLocator(set.rotator, this.pubkey, ROOT_SCOPE_HEX, set.newEpoch));
      if (!blob) continue;
      try {
        const plain = await this.signer.nip44.decrypt(set.rotator, blob.wrapped);
        const newKey = decodeWrappedKey(base64ToBytes(plain), new Uint8Array(32), set.newEpoch);
        if (!adopted || lowerKeyWins(adopted.key, newKey) === newKey) adopted = { key: newKey, rotator: set.rotator };
      } catch {
        // undecryptable blob at our locator — treat as absent
      }
    }
    if (!this.runtimes.has(rt.material.community_id)) return; // torn down while awaiting

    if (adopted) {
      rt.rekeyHandled.add(targetEpoch);
      this.adoptRefounding(rt, adopted.key, targetEpoch, adopted.rotator);
    } else if (sawComplete) {
      rt.rekeyHandled.add(targetEpoch);
      this.handleRemoved(rt);
    }
  }

  /**
   * Follow a Refounding forward: roll the runtime to the new root/epoch, keep
   * the prior root in `held_roots` so past history stays decodable, re-derive
   * plane keys, and re-open subscriptions at the new addresses (the old
   * planeMap entries are retained so already-fetched history still decodes).
   */
  private adoptRefounding(rt: Runtime, newRoot: Uint8Array, newEpoch: number, refounder: string): void {
    const priorRoots = Array.isArray(rt.material.held_roots) ? rt.material.held_roots : [];
    rt.material = {
      ...rt.material,
      community_root: toHex(newRoot),
      root_epoch: newEpoch,
      refounder,
      held_roots: [{ epoch: rt.material.root_epoch, key: rt.material.community_root }, ...priorRoots],
    };
    rt.keys = deriveKeys(rt.material, rt.state$.value.channels);
    this.openControlSub(rt); // re-subscribe control/guestbook/dissolved + next rekey at the new epoch
    this.reconcileChannelSub(rt);
    this.refold(rt);
    void this.saveMaterials();
    void this.saveCommunityList();
  }

  /**
   * Initiate a Refounding (CORD-06 §3): roll the community_root to sever the
   * excluded, deliver the new root to `keep` as rekey blobs at the base-rekey
   * address (under the PRIOR root), compact the Control Plane by re-wrapping each
   * head's plaintext seal into the new epoch, seed the new Guestbook with a
   * snapshot, then follow our own rotation forward. Requires BAN or ownership +
   * a NIP-44 signer (pairwise wrapping is one ECDH either side can compute).
   */
  async refound(cid: string, opts: { keep: string[]; exclude?: string[] }): Promise<void> {
    const rt = this.runtimes.get(cid);
    if (!rt) throw new Error("unknown community");
    if (!this.signer.nip44) throw new Error("this signer can't rotate keys (NIP-44 unsupported)");
    const state = rt.state$.value;
    const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    const s = resolveStanding(this.pubkey, rt.material.owner, rolesMap, state.grants);
    if (!s.isOwner && !hasPerm(s.permissions, PERM.BAN)) throw new Error("need BAN or ownership to refound");

    const excluded = new Set(opts.exclude ?? []);
    const recipients = [...new Set([this.pubkey, ...opts.keep])].filter((pk) => !excluded.has(pk));
    const oldRoot = fromHex(rt.material.community_root);
    const oldEpoch = rt.material.root_epoch;
    const newEpoch = oldEpoch + 1;
    const cidBytes = fromHex(rt.material.community_id);
    const newRoot = generateSecretKey();
    const prevCommit = toHex(epochKeyCommitment(oldEpoch, oldRoot));
    const relays = this.relaysFor(rt);

    // 1. The root roll: per-recipient rekey blobs at the base-rekey address
    //    (keyed by the PRIOR root, so every current holder converges).
    const plain = bytesToBase64(encodeWrappedKey(ZERO_32, BigInt(newEpoch), newRoot));
    const blobs = [];
    for (const pk of recipients) {
      const wrapped = await this.signer.nip44.encrypt(pk, plain);
      blobs.push({ locator: rekeyLocator(this.pubkey, pk, ROOT_SCOPE_HEX, BigInt(newEpoch)), wrapped });
    }
    const rekeyAddr = baseRekeyGroupKey(oldRoot, cidBytes, newEpoch);
    for (const rumor of buildRekeyRumors(
      { scope: { kind: "root" }, newEpoch: BigInt(newEpoch), prevEpoch: BigInt(oldEpoch), prevCommit },
      blobs,
    )) {
      const { wrap } = await createStreamEvent({ streamSk: rekeyAddr.sk, convKey: rekeyAddr.convKey, author: this.signer, rumor });
      await this.pool.publish(relays, wrap).catch((err) => console.warn("rekey publish failed", err));
    }

    // 2. Compaction: re-wrap each Control-Plane head's plaintext seal into the
    //    new epoch so members read current state without re-syncing from genesis.
    const newControl = controlGroupKey(newRoot, cidBytes, newEpoch);
    for (const head of state.heads?.values() ?? []) {
      if (!head.seal || head.sealKind !== KIND.SEAL_PLAINTEXT) continue;
      try {
        this.pool.publish(relays, rewrapSeal(head.seal, newControl.sk, newControl.convKey)).catch(() => {});
      } catch {
        /* an encrypted-seal head can't re-wrap; control heads are plaintext by construction */
      }
    }

    // 3. Guestbook snapshot (best-effort, non-gating — CORD-02 §5).
    const newGuestbook = guestbookGroupKey(newRoot, cidBytes, newEpoch);
    for (const rumor of buildSnapshotRumors(recipients, toHex(generateSecretKey()))) {
      const { wrap } = await createStreamEvent({ streamSk: newGuestbook.sk, convKey: newGuestbook.convKey, author: this.signer, rumor });
      this.pool.publish(relays, wrap).catch(() => {});
    }

    // 4. Follow our own rotation forward.
    rt.rekeyHandled.add(newEpoch);
    this.adoptRefounding(rt, newRoot, newEpoch, this.pubkey);
  }

  /** We were excluded from a Refounding: tombstone the membership and tear down. */
  private handleRemoved(rt: Runtime): void {
    const cid = rt.material.community_id;
    rt.controlSub?.unsubscribe();
    rt.channelSub?.unsubscribe();
    if (rt.persistTimer) clearTimeout(rt.persistTimer);
    if (rt.refoldTimer) clearTimeout(rt.refoldTimer);
    if (rt.rekeyTimer) clearTimeout(rt.rekeyTimer);
    this.clearCache(cid);
    this.runtimes.delete(cid);
    this.communityList = removeFromList(this.communityList, cid, Date.now());
    void this.saveMaterials();
    this.emitCommunities();
    void this.saveCommunityList();
  }

  // ---- message assembly ---------------------------------------------------

  private recomputeMessages(rt: Runtime, channelId: string): void {
    const subj = rt.messages$.get(channelId);
    if (!subj) return;
    const events = rt.channelEvents.get(channelId);
    const byId = new Map<string, ChatMessage>();
    // target -> reaction content -> { url?, authors }. A custom emoji reaction's
    // content is `:shortcode:` and carries the image URL from its own emoji tag.
    const reactions = new Map<string, Map<string, { url?: string; authors: Set<string> }>>();
    const edits: DecodedEvent[] = [];
    const deletes: DecodedEvent[] = [];

    if (events) {
      const sorted = [...events.values()].sort((a, b) => a.ms - b.ms);
      for (const d of sorted) {
        const r = d.rumor;
        if (r.kind === KIND.MESSAGE) {
          const q = r.tags.find((t) => t[0] === "q");
          byId.set(r.id, {
            id: r.id,
            author: d.author,
            content: r.content,
            ms: d.ms,
            deleted: false,
            replyTo: q ? { id: q[1], author: q[3] ?? "" } : undefined,
            reactions: [],
            attachments: [...parseImeta(r.tags).values()],
            emojiTags: r.tags.filter((t) => t[0] === "emoji"),
            raw: d,
          });
        } else if (r.kind === KIND.EDIT) {
          edits.push(d);
        } else if (r.kind === KIND.DELETE) {
          deletes.push(d);
        } else if (r.kind === KIND.REACTION) {
          const target = r.tags.find((t) => t[0] === "e")?.[1];
          if (!target) continue;
          let emap = reactions.get(target);
          if (!emap) {
            emap = new Map();
            reactions.set(target, emap);
          }
          let entry = emap.get(r.content);
          if (!entry) {
            // NIP-30: resolve a custom `:shortcode:` reaction to its image URL
            // via applesauce (plain unicode reactions resolve to undefined).
            const custom = getReactionEmoji(r as unknown as NostrEvent);
            entry = { url: custom?.url, authors: new Set() };
            emap.set(r.content, entry);
          }
          entry.authors.add(d.author);
        }
      }
    }

    // Apply edits/deletes only from the message's own author.
    for (const d of edits) {
      const targetId = d.rumor.tags.find((t) => t[0] === "e")?.[1];
      const msg = targetId ? byId.get(targetId) : undefined;
      if (msg && msg.author === d.author) msg.edited = d.rumor.content;
    }
    for (const d of deletes) {
      for (const t of d.rumor.tags) {
        if (t[0] !== "e") continue;
        const msg = byId.get(t[1]);
        if (msg && msg.author === d.author) msg.deleted = true;
      }
    }
    for (const [target, emap] of reactions) {
      const msg = byId.get(target);
      if (!msg) continue;
      msg.reactions = [...emap.entries()].map(([emoji, { url, authors }]) => ({
        emoji,
        url,
        count: authors.size,
        authors: [...authors],
      }));
    }

    subj.next([...byId.values()].sort((a, b) => a.ms - b.ms));
  }

  // ---- publishing ---------------------------------------------------------

  private async publishToPlane(
    rt: Runtime,
    key: GroupKey,
    rumor: { kind: number; content: string; tags: string[][]; created_at?: number },
    opts: { plaintext?: boolean; ephemeral?: boolean },
  ): Promise<string> {
    const { wrap, rumorId } = await createStreamEvent({
      streamSk: key.sk,
      convKey: key.convKey,
      author: this.signer,
      rumor,
      plaintextSeal: opts.plaintext,
      ephemeral: opts.ephemeral,
    });
    const relays = rt.material.relays.length ? rt.material.relays : this.defaultRelays;
    // Optimistic local echo first, so the UI updates even before relays ack.
    if (!opts.ephemeral) this.ingest(rt, wrap);
    // Publish in the background — never block the UI on relay round-trips.
    this.pool.publish(relays, wrap).catch((err) => console.warn("publish failed", err));
    return rumorId;
  }

  // ---- community list (kind 13302) ----------------------------------------

  private async loadCommunityList(): Promise<void> {
    try {
      const events = await firstValueFrom(
        this.pool
          .request(this.defaultRelays, [{ kinds: [KIND.COMMUNITY_LIST], authors: [this.pubkey] }])
          .pipe(toArray(), timeout(8000)),
      ).catch(() => [] as NostrEvent[]);
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!newest || !this.signer.nip44) return;
      // Decrypt through applesauce's encrypted-content cache: the plaintext is
      // memoised on the (deduped) stored event, so a re-fold, StrictMode double
      // mount, or another client instance won't re-prompt the signer.
      this.eventStore.add(newest);
      const latest = this.eventStore.getReplaceable(KIND.COMMUNITY_LIST, this.pubkey) ?? newest;
      if (!isEncryptedContentUnlocked(latest)) {
        await unlockEncryptedContent(latest, this.pubkey, this.signer);
      }
      const json = getEncryptedContent(latest);
      if (!json) return;
      const remote = JSON.parse(json) as CommunityList;
      // Merge into our document rather than replace — preserves tombstones,
      // other-device entries, and lowest-epoch seeds (CORD-02 §8).
      this.communityList = mergeCommunityLists(this.communityList, remote);
      // Liveness is DERIVED, not "present in tombstones": a leave-then-rejoin
      // (added_at > removed_at) legitimately resurrects, so a blanket tombstone
      // drop would wrongly hide re-joined communities and diverge from armada.
      let added = false;
      for (const entry of this.communityList.entries) {
        const m = entry.current;
        if (!m?.community_id || !isCommunityLive(this.communityList, m.community_id)) continue;
        if (!this.runtimes.has(m.community_id)) {
          this.addRuntime(m);
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
      // Reconcile the merged document with the live runtimes: add new joins,
      // refresh the `current` snapshot for local material changes (a fresh
      // channel key, a rename), and resurrect a re-joined tombstoned community
      // by bumping its add past the removal. Tombstones + other-device entries
      // are preserved (CORD-02 §8), never clobbered.
      const nowMs = Date.now();
      let list = this.communityList;
      for (const rt of this.runtimes.values()) {
        const cid = rt.material.community_id;
        const existing = list.entries.find((e) => e.community_id === cid);
        if (!existing) {
          list = addToList(list, { community_id: cid, seed: rt.material, current: rt.material, added_at: nowMs });
          continue;
        }
        list = refreshCurrent(list, rt.material);
        const tomb = list.tombstones.find((t) => t.community_id === cid);
        if (tomb && existing.added_at <= tomb.removed_at) {
          list = addToList(list, { ...existing, current: rt.material, added_at: nowMs });
        }
      }
      this.communityList = list;
      if (!withinByteCap(list)) {
        console.warn("community list exceeds the NIP-44 byte cap; not publishing");
        return;
      }
      const plaintext = JSON.stringify(list);
      const content = await this.signer.nip44.encrypt(this.pubkey, plaintext);
      const signed = await this.signer.signEvent({
        kind: KIND.COMMUNITY_LIST,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });
      this.eventStore.add(signed);
      const stored = this.eventStore.getReplaceable(KIND.COMMUNITY_LIST, this.pubkey) ?? signed;
      // Seed the decryption cache with what we just encrypted, so re-reading our
      // own freshly-published list never round-trips the signer again.
      setEncryptedContentCache(stored, plaintext);
      this.pool.publish(this.defaultRelays, signed).catch((err) => console.warn("list publish failed", err));
    } catch (err) {
      console.warn("failed to save community list", err);
    }
  }

  // ---- helpers for UI -----------------------------------------------------

  standingOf(cid: string, member: string): Standing {
    const rt = this.runtimes.get(cid)!;
    const state = rt.state$.value;
    const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    return resolveStanding(member, rt.material.owner, rolesMap, state.grants);
  }

  canDo(cid: string, perm: bigint, targetPosition = 0xffffffff): boolean {
    const me = this.standingOf(cid, this.pubkey);
    return canActOn(me, { permissions: 0n, position: targetPosition, isOwner: false, roleIds: [] }, perm);
  }
}
