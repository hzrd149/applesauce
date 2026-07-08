// ConcordClient — the reactive engine.
//
// Uses applesauce (EventStore + RelayPool) for all Nostr I/O, and the Concord
// protocol layer (crypto/stream/control/guestbook/invite) to fold plane events
// into reactive community state. One instance per logged-in user.

import { BehaviorSubject, Subscription, firstValueFrom, timeout, toArray } from "rxjs";
import { finalizeEvent, kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";

import type { IEventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import {
  getHiddenContent,
  isHiddenContentUnlocked,
  setHiddenContentCache,
  unlockHiddenContent,
} from "applesauce-core/helpers";
import { getReactionEmoji } from "applesauce-common/helpers";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { parseImeta, type AttachmentEncryption, type MediaAttachment } from "./helpers/imeta.js";
import { banlistLocator, grantLocator, inviteLinksLocator } from "./helpers/crypto.js";
import { decodeWrapCached } from "./helpers/gift-wrap.js";
import { MAX_CHANNEL_CACHE, defaultKeyStorage, memoryStorage } from "./storage.js";
import type { CachedEntry, ConcordKeyStorage, ConcordStorage, ConcordUploader } from "./storage.js";
import { ConcordRelayAuth } from "./relay-auth.js";
import { foldControl } from "./helpers/control.js";
import {
  communityListWithinByteCap,
  isCommunityLive,
  mergeCommunities,
  mergeCommunityTombstones,
} from "./helpers/community-list.js";
import { joinCommunity, leaveCommunity, refreshCommunity } from "./operations/community-list.js";
import { foldMembers } from "./helpers/guestbook.js";
import { canActOn, refoundAuthority, resolveStanding } from "./helpers/permissions.js";
import type { Standing } from "./helpers/permissions.js";
import { createCommunity, verifyOwner } from "./helpers/community.js";
import {
  addChannelKey,
  buildRefounding,
  channelEpochOf,
  deriveConcordKeys,
  readRekey,
  wrapForTarget,
} from "./helpers/keys.js";
import type { ConcordKeys, PlaneInfo, WrapTarget } from "./helpers/keys.js";
import { computeEditionHash } from "./helpers/editions.js";
import { checkChatBinding } from "./helpers/chat.js";
import {
  buildInviteLink,
  decryptBundle,
  INVITE_BUNDLE_KIND,
  newInviteToken,
  parseInviteLink,
  STOCK_RELAYS,
} from "./helpers/invite.js";
import type { Emoji } from "applesauce-core/factories";
import { ChatMessageFactory, CommentFactory, ForumThreadFactory, ReactionFactory } from "applesauce-common/factories";
import { DeleteFactory } from "./factories/chat.js";
import { EditFactory } from "./factories/edit.js";
import { bindToChannel, includeMediaEncryption, type MediaEncryption } from "./operations/chat.js";
import type { EventTemplate } from "applesauce-core/helpers/event";
import { DissolutionFactory, EditionFactory } from "./factories/control.js";
import { JoinLeaveFactory, KickFactory } from "./factories/guestbook.js";
import { InviteBundleFactory } from "./factories/invite.js";
import {
  VSK,
  type BlobPointer,
  type CommunityListCommunity,
  type CommunityMetadata,
  type CommunityState,
  type CommunityTombstone,
  type DecodedEvent,
  type InviteBundle,
  type JoinMaterial,
  type Role,
} from "./types.js";
import { EPHEMERAL_GIFT_WRAP_KIND, GIFT_WRAP_KIND } from "./helpers/gift-wrap.js";
import { EDIT_KIND } from "./helpers/edit.js";
import { VOICE_PRESENCE_KIND } from "./helpers/voice.js";
import { COMMUNITY_LIST_KIND } from "./helpers/community-list.js";

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

interface Runtime {
  /** Every cryptographic key for this community — the single state object.
   *  `keys.material` is the persisted source of truth; `keys.planes` is the
   *  decrypt-side address lookup. */
  keys: ConcordKeys;
  controlEvents: Map<string, DecodedEvent>;
  guestbookEvents: Map<string, DecodedEvent>;
  channelEvents: Map<string, Map<string, DecodedEvent>>;
  observed: Map<string, number>;
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
  /** The authoritative 13302 document (CORD-02 §8): two merged, never-clobbered
   *  arrays kept independently, exactly as the encrypted list is serialized. */
  private communities: CommunityListCommunity[] = [];
  private communityTombstones: CommunityTombstone[] = [];

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
      const mats = [...this.runtimes.values()].map((r) => r.keys.material);
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
    const genesis = await createCommunity({
      ownerPubkey: this.pubkey,
      name,
      description,
      relays: relays.length ? relays : this.defaultRelays,
    });
    const rt = this.addRuntime(genesis.material);
    await this.saveMaterials();
    // Publish genesis control editions (plaintext seal) + owner Join.
    for (const rumor of genesis.controlRumors) {
      await this.publishToPlane(rt, { plane: "control" }, rumor, { plaintext: true });
    }
    for (const rumor of genesis.guestbookRumors) {
      await this.publishToPlane(rt, { plane: "guestbook" }, rumor, {});
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
        .request(relays, [{ kinds: [INVITE_BUNDLE_KIND], authors: [parsed.linkSigner] }])
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
    const joinRumor = await JoinLeaveFactory.create("join", {
      invite: bundle.creator_npub ? { creator: bundle.creator_npub, label: bundle.label } : undefined,
    });
    await this.publishToPlane(rt, { plane: "guestbook" }, joinRumor, {});
    await this.saveCommunityList();
    this.status$.next("");
    return material.community_id;
  }

  // ---- chat actions -------------------------------------------------------

  private channelEpoch(rt: Runtime, channelId: string): number {
    return channelEpochOf(rt.keys, channelId);
  }

  /**
   * Publish ANY event to a channel (CORD-03). `source` may be an `EventFactory`
   * from any applesauce package, a plain template, or a signed event — its kind
   * is preserved. The CORD-03 channel/epoch binding and the CORD-02 `ms`
   * ordering remainder are appended, then the rumor is sealed + wrapped.
   */
  async sendEvent(
    cid: string,
    channelId: string,
    source: PromiseLike<EventTemplate> | EventTemplate,
    opts: { plaintext?: boolean; ephemeral?: boolean } = {},
  ): Promise<string> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    const rumor = await bindToChannel(channelId, epoch)(await source);
    return this.publishToPlane(rt, { plane: "channel", channelId }, rumor, opts);
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
        if (!attachment.url) throw new Error("uploader did not return a url");
        attachments.push(attachment);
        content = content ? `${content}\n${attachment.url}` : attachment.url;
      }
    }

    // Build the kind 9 message with applesauce-common, bind it to the channel,
    // then decorate its imeta tags with the per-file encryption keys.
    let factory = ChatMessageFactory.create(content, { emojis });
    if (replyTo) factory = factory.replyTo({ id: replyTo.id, author: replyTo.author });
    if (attachments?.length) factory = factory.attachments(attachments);
    const encryption: MediaEncryption[] = (attachments ?? [])
      .filter(
        (a): a is MediaAttachment & { url: string; encryption: AttachmentEncryption } => !!a.url && !!a.encryption,
      )
      .map((a) => ({ url: a.url, ...a.encryption }));

    let rumor = await bindToChannel(channelId, epoch)(await factory);
    rumor = await includeMediaEncryption(encryption)(rumor);
    await this.publishToPlane(rt, { plane: "channel", channelId }, rumor, {});
  }

  /** Post a NIP-7D forum thread (kind 11) to a channel. */
  async sendThread(cid: string, channelId: string, title: string, body = ""): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    const rumor = await bindToChannel(channelId, epoch)(await ForumThreadFactory.create(title, body));
    await this.publishToPlane(rt, { plane: "channel", channelId }, rumor, {});
  }

  /**
   * Reply to a channel thread with a NIP-22 kind 1111 comment to the root
   * (NIP-7D). `thread` identifies the root kind 11 thread being replied to.
   */
  async replyToThread(
    cid: string,
    channelId: string,
    thread: { id: string; author: string },
    body: string,
  ): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    const pointer = { type: "event" as const, id: thread.id, kind: kinds.ForumThread, pubkey: thread.author };
    const rumor = await bindToChannel(channelId, epoch)(await CommentFactory.create(pointer, body));
    await this.publishToPlane(rt, { plane: "channel", channelId }, rumor, {});
  }

  async react(
    cid: string,
    channelId: string,
    target: { id: string; author: string },
    reaction: string | Emoji,
  ): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    const rumor = await bindToChannel(
      channelId,
      epoch,
    )(await ReactionFactory.create({ id: target.id, pubkey: target.author, kind: kinds.ChatMessage }, reaction));
    await this.publishToPlane(rt, { plane: "channel", channelId }, rumor, {});
  }

  async editMessage(cid: string, channelId: string, targetId: string, text: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    await this.publishToPlane(
      rt,
      { plane: "channel", channelId },
      await EditFactory.create(channelId, epoch, targetId, text),
      {},
    );
  }

  async deleteMessage(cid: string, channelId: string, targetId: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const epoch = this.channelEpoch(rt, channelId);
    await this.publishToPlane(
      rt,
      { plane: "channel", channelId },
      await DeleteFactory.create(channelId, epoch, targetId),
      {},
    );
  }

  // ---- admin actions ------------------------------------------------------

  private buildVac(rt: Runtime, actor: string): [string, string, string] | undefined {
    if (actor === rt.keys.material.owner) return undefined;
    const eid = grantLocator(hexToBytes(rt.keys.material.community_id), actor);
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
    const rumor = await EditionFactory.create({ vsk, eid, version, prevHash: latest?.hash, content, vac });
    await this.publishToPlane(rt, { plane: "control" }, rumor, { plaintext: true });
  }

  async editMetadata(cid: string, patch: Partial<CommunityMetadata>): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const current = rt.state$.value.metadata ?? { name: rt.keys.material.name, relays: rt.keys.material.relays };
    const next: CommunityMetadata = { ...current, ...patch };
    await this.publishEdition(rt, VSK.METADATA, rt.keys.material.community_id, JSON.stringify(next));
  }

  /**
   * Encrypt an image via the injected uploader and publish the resulting
   * {@link BlobPointer} into the community metadata as the icon or banner
   * (CORD-02 §6). The plaintext never leaves the device.
   */
  async setCommunityImage(cid: string, which: "icon" | "banner", file: Blob): Promise<void> {
    if (!this.uploader) throw new Error("no uploader configured: cannot set community image");
    const att = await this.uploader.upload(file, cid);
    if (!att.encryption || !att.originalSha256 || !att.url)
      throw new Error("uploader did not return an encrypted attachment");
    const pointer: BlobPointer = {
      url: att.url,
      key: att.encryption.key,
      nonce: att.encryption.nonce,
      hash: att.originalSha256,
    };
    await this.editMetadata(cid, { [which]: pointer });
  }

  /** Clear the community icon or banner. */
  async removeCommunityImage(cid: string, which: "icon" | "banner"): Promise<void> {
    await this.editMetadata(cid, { [which]: undefined });
  }

  async createChannel(cid: string, name: string, isPrivate: boolean, voice = false): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const channelId = bytesToHex(generateSecretKey());
    if (isPrivate) {
      // A private channel mints its own key; grant-holders get it in invites.
      rt.keys = addChannelKey(rt.keys, channelId, name);
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
    await this.publishEdition(
      rt,
      VSK.CHANNEL,
      channelId,
      JSON.stringify({ name: ch.name, private: ch.private, deleted: true }),
    );
  }

  async createRole(cid: string, name: string, position: number, permissions: bigint): Promise<string> {
    const rt = this.runtimes.get(cid)!;
    const roleId = bytesToHex(generateSecretKey());
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
    const eid = grantLocator(hexToBytes(rt.keys.material.community_id), member);
    await this.publishEdition(rt, VSK.GRANT, eid, JSON.stringify({ member, role_ids: roleIds }));
  }

  async kick(cid: string, member: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    // Strip roles first, then the cooperative Kick directive (CORD-04 §6).
    await this.grantRoles(cid, member, []);
    const vac = this.buildVac(rt, this.pubkey);
    await this.publishToPlane(rt, { plane: "guestbook" }, await KickFactory.create(member, vac), {});
  }

  async ban(cid: string, member: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const current = new Set(rt.state$.value.banlist);
    current.add(member);
    const eid = banlistLocator(hexToBytes(rt.keys.material.community_id));
    await this.publishEdition(rt, VSK.BANLIST, eid, JSON.stringify([...current]));
    await this.grantRoles(cid, member, []);
    // NOTE: full enforcement also requires a Refounding (rekey) — CORD-06.
  }

  async unban(cid: string, member: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    const current = new Set(rt.state$.value.banlist);
    current.delete(member);
    const eid = banlistLocator(hexToBytes(rt.keys.material.community_id));
    await this.publishEdition(rt, VSK.BANLIST, eid, JSON.stringify([...current]));
  }

  async dissolve(cid: string): Promise<void> {
    const rt = this.runtimes.get(cid)!;
    if (this.pubkey !== rt.keys.material.owner) throw new Error("only the owner can dissolve");
    await this.publishToPlane(rt, { plane: "dissolved" }, await DissolutionFactory.create(), { plaintext: true });
  }

  async leave(cid: string): Promise<void> {
    const rt = this.runtimes.get(cid);
    if (!rt) return;
    await this.publishToPlane(rt, { plane: "guestbook" }, await JoinLeaveFactory.create("leave"), {});
    rt.controlSub?.unsubscribe();
    rt.channelSub?.unsubscribe();
    if (rt.persistTimer) clearTimeout(rt.persistTimer);
    this.clearCache(cid);
    this.runtimes.delete(cid);
    // Tombstone the membership so the leave propagates across devices/clients
    // (a bare omission would merge back as still-joined — CORD-02 §8).
    this.communityTombstones = leaveCommunity(cid, Date.now())(this.communities, this.communityTombstones).tombstones;
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
    const channels = rt.keys.material.channels.map((c) => ({ id: c.id, key: c.key, epoch: c.epoch, name: c.name }));

    const bundle: InviteBundle = {
      community_id: rt.keys.material.community_id,
      owner: rt.keys.material.owner,
      owner_salt: rt.keys.material.owner_salt,
      community_root: rt.keys.material.community_root,
      root_epoch: rt.keys.material.root_epoch,
      channels,
      relays: rt.keys.material.relays,
      name: state.metadata?.name ?? rt.keys.material.name,
      icon: state.metadata?.icon,
      creator_npub: this.pubkey,
    };

    const template = await InviteBundleFactory.create(bundle, token);
    const signed = finalizeEvent(template, linkSk);
    this.eventStore.add(signed);
    const inviteRelays = rt.keys.material.relays.length ? rt.keys.material.relays : this.defaultRelays;
    this.pool.publish(inviteRelays, signed).catch((err) => console.warn("bundle publish failed", err));

    // Register the link into the community (CORD-05 §5) so it counts as Public.
    const registryEid = inviteLinksLocator(hexToBytes(rt.keys.material.community_id), this.pubkey);
    const existing = this.latestEdition(rt, registryEid);
    let links: string[] = [];
    try {
      if (existing) links = JSON.parse(existing.content) as string[];
    } catch {
      /* ignore */
    }
    if (!links.includes(linkPub)) links.push(linkPub);
    await this.publishEdition(rt, VSK.INVITE_REGISTRY, registryEid, JSON.stringify(links));

    return buildInviteLink(
      base,
      linkPub,
      token,
      rt.keys.material.relays.length ? rt.keys.material.relays : this.defaultRelays,
    );
  }

  // ---- internal: runtime & subscriptions ----------------------------------

  private addRuntime(material: JoinMaterial): Runtime {
    const rt: Runtime = {
      keys: deriveConcordKeys(material, []),
      controlEvents: new Map(),
      guestbookEvents: new Map(),
      channelEvents: new Map(),
      observed: new Map(),
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
    return rt.keys.material.relays.length ? rt.keys.material.relays : this.defaultRelays;
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
    const filters = [{ kinds: [GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND], authors }];
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
    // Every plane address + convKey already lives in rt.keys (deriveConcordKeys),
    // including the dissolved plane and the NEXT epoch's base-rekey listen
    // address (CORD-06 §2) where an armada Refounding publishes the new root.
    // Here we only register the core stream keys so an auth-gating relay can be
    // answered as these derived addresses (NIP-42) and open the subscription.
    const { control, guestbook, dissolved, nextBaseRekey } = rt.keys;
    this.relayAuth.registerStreamKeys([control, guestbook, dissolved, nextBaseRekey.key]);
    const authors = [control.pk, guestbook.pk, dissolved.pk, nextBaseRekey.key.pk];
    rt.controlSub?.unsubscribe();
    rt.controlSub = this.subscribeWraps(rt, authors);
  }

  /** Reopen the channel subscription only when the set of channel addresses
   * actually changes — so discovering a channel never disturbs the control
   * subscription (which was the source of a mid-sync teardown race). */
  private reconcileChannelSub(rt: Runtime): void {
    // Channel plane entries (with the epoch each key derives at, for the CORD-03
    // §44 receive binding) already live in rt.keys.planes. Here we only register
    // the channel stream keys so the channel REQ can pass an auth gate, and
    // reopen the subscription when the address set changes.
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
    const info = rt.keys.planes.get(event.pubkey);
    if (!info) return;
    // Cross-plane dedup (previously only control/guestbook were guarded, so
    // channel wraps were re-decrypted on every reload and every relay echo).
    if (event.kind !== EPHEMERAL_GIFT_WRAP_KIND && this.haveWrap(rt, info, event.id)) return;
    // Add to the applesauce EventStore first: it dedups by id and hands back the
    // canonical instance, and decodeWrapCached memoises the decode on that
    // instance's symbol — so even paths that slip past haveWrap decrypt only once.
    const canonical = (this.eventStore.add(event) as NostrEvent | null) ?? event;
    const decoded = decodeWrapCached(canonical, info.convKey);
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
        if (
          decoded.author === rt.keys.material.owner &&
          decoded.rumor.tags.some((t) => t[0] === "vsk" && t[1] === "10")
        ) {
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
        if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;
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
    for (const entry of this.loadCache(rt.keys.material.community_id)) {
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
    this.saveCache(rt.keys.material.community_id, entries);
  }

  private scheduleRefold(rt: Runtime): void {
    if (rt.refoldTimer) return;
    rt.refoldTimer = setTimeout(() => {
      rt.refoldTimer = undefined;
      this.refold(rt);
    }, 60);
  }

  private refold(rt: Runtime): void {
    const state = foldControl([...rt.controlEvents.values()], rt.keys.material);
    // Re-derive current-epoch keys, retaining prior-epoch plane addresses so
    // already-fetched history still decodes.
    rt.keys = deriveConcordKeys(rt.keys.material, state.channels, rt.keys);

    const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    const standing = (m: string): Standing => resolveStanding(m, rt.keys.material.owner, rolesMap, state.grants);
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
    const state = rt.state$.value;
    const outcome = await readRekey(
      rt.keys,
      rt.rekeyEvents.values(),
      refoundAuthority(state),
      this.pubkey,
      this.signer,
      state.channels,
    );
    if (outcome.kind === "none") return;
    // Adopt/tombstone at most once per target epoch, and bail if we were torn
    // down while awaiting the pairwise decrypt.
    if (rt.rekeyHandled.has(outcome.epoch)) return;
    if (!this.runtimes.has(rt.keys.material.community_id)) return;

    rt.rekeyHandled.add(outcome.epoch);
    if (outcome.kind === "adopt") this.adoptRefounding(rt, outcome.next);
    else this.handleRemoved(rt);
  }

  /**
   * Follow a Refounding forward: swap in the rolled-forward key state (which
   * already keeps the prior root in `held_roots` and retains the prior plane
   * addresses so past history stays decodable) and re-open subscriptions at the
   * new epoch's addresses.
   */
  private adoptRefounding(rt: Runtime, next: ConcordKeys): void {
    rt.keys = next;
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
    const state = rt.state$.value;
    if (!refoundAuthority(state)(this.pubkey)) throw new Error("need BAN or ownership to refound");

    const excluded = new Set(opts.exclude ?? []);
    const recipients = [...new Set([this.pubkey, ...opts.keep])].filter((pk) => !excluded.has(pk));
    const relays = this.relaysFor(rt);

    // Build the entire rotation (rekey blobs, compaction, guestbook snapshot) +
    // the rolled-forward key state as pure functions over the key state; the
    // class only publishes the wraps and adopts the new state.
    const plan = await buildRefounding(rt.keys, this.signer, {
      recipients,
      self: this.pubkey,
      heads: state.heads?.values() ?? [],
      channels: state.channels,
    });

    // Rekey blobs gate every recipient's convergence, so land them first; the
    // compaction + snapshot are best-effort (non-gating — CORD-02 §5).
    for (const wrap of plan.rekeyWraps) {
      await this.pool.publish(relays, wrap).catch((err) => console.warn("rekey publish failed", err));
    }
    for (const wrap of plan.compactionWraps) this.pool.publish(relays, wrap).catch(() => {});
    for (const wrap of plan.snapshotWraps) this.pool.publish(relays, wrap).catch(() => {});

    // Follow our own rotation forward.
    rt.rekeyHandled.add(plan.newEpoch);
    this.adoptRefounding(rt, plan.next);
  }

  /** We were excluded from a Refounding: tombstone the membership and tear down. */
  private handleRemoved(rt: Runtime): void {
    const cid = rt.keys.material.community_id;
    rt.controlSub?.unsubscribe();
    rt.channelSub?.unsubscribe();
    if (rt.persistTimer) clearTimeout(rt.persistTimer);
    if (rt.refoldTimer) clearTimeout(rt.refoldTimer);
    if (rt.rekeyTimer) clearTimeout(rt.rekeyTimer);
    this.clearCache(cid);
    this.runtimes.delete(cid);
    this.communityTombstones = leaveCommunity(cid, Date.now())(this.communities, this.communityTombstones).tombstones;
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
        if (r.kind === kinds.ChatMessage) {
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
        } else if (r.kind === EDIT_KIND) {
          edits.push(d);
        } else if (r.kind === kinds.EventDeletion) {
          deletes.push(d);
        } else if (r.kind === kinds.Reaction) {
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
    target: WrapTarget,
    rumor: { kind: number; content: string; tags: string[][]; created_at?: number },
    opts: { plaintext?: boolean; ephemeral?: boolean },
  ): Promise<string> {
    // The wrap is built purely from the key state + our signer; the class only
    // echoes it locally and publishes it.
    const { wrap, rumorId } = await wrapForTarget(rt.keys, target, this.signer, rumor, opts);
    const relays = this.relaysFor(rt);
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
          .request(this.defaultRelays, [{ kinds: [COMMUNITY_LIST_KIND], authors: [this.pubkey] }])
          .pipe(toArray(), timeout(8000)),
      ).catch(() => [] as NostrEvent[]);
      const newest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!newest || !this.signer.nip44) return;
      // Decrypt through applesauce's hidden-content cache: the plaintext is
      // memoised on the (deduped) stored event, so a re-fold, StrictMode double
      // mount, or another client instance won't re-prompt the signer.
      this.eventStore.add(newest);
      const latest = this.eventStore.getReplaceable(COMMUNITY_LIST_KIND, this.pubkey) ?? newest;
      if (!isHiddenContentUnlocked(latest)) {
        await unlockHiddenContent(latest, this.signer);
      }
      const json = getHiddenContent(latest);
      if (!json) return;
      // The wire document keys the array as `entries` (armada-compatible).
      const remote = JSON.parse(json) as { entries?: CommunityListCommunity[]; tombstones?: CommunityTombstone[] };
      // Merge into our arrays rather than replace — preserves tombstones,
      // other-device communities, and lowest-epoch seeds (CORD-02 §8).
      this.communities = mergeCommunities(this.communities, remote.entries ?? []);
      this.communityTombstones = mergeCommunityTombstones(this.communityTombstones, remote.tombstones ?? []);
      // Liveness is DERIVED, not "present in tombstones": a leave-then-rejoin
      // (added_at > removed_at) legitimately resurrects, so a blanket tombstone
      // drop would wrongly hide re-joined communities and diverge from armada.
      let added = false;
      for (const community of this.communities) {
        const m = community.current;
        if (!m?.community_id || !isCommunityLive(this.communities, this.communityTombstones, m.community_id))
          continue;
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
      let communities = this.communities;
      const tombstones = this.communityTombstones;
      for (const rt of this.runtimes.values()) {
        const cid = rt.keys.material.community_id;
        const existing = communities.find((e) => e.community_id === cid);
        if (!existing) {
          communities = joinCommunity({
            community_id: cid,
            seed: rt.keys.material,
            current: rt.keys.material,
            added_at: nowMs,
          })(communities, tombstones).communities;
          continue;
        }
        communities = refreshCommunity(rt.keys.material)(communities, tombstones).communities;
        const tomb = tombstones.find((t) => t.community_id === cid);
        if (tomb && existing.added_at <= tomb.removed_at) {
          communities = joinCommunity({ ...existing, current: rt.keys.material, added_at: nowMs })(
            communities,
            tombstones,
          ).communities;
        }
      }
      this.communities = communities;
      if (!communityListWithinByteCap(communities, tombstones)) {
        console.warn("community list exceeds the NIP-44 byte cap; not publishing");
        return;
      }
      // The wire document keys the array as `entries` (armada-compatible).
      const plaintext = JSON.stringify({ entries: communities, tombstones });
      const content = await this.signer.nip44.encrypt(this.pubkey, plaintext);
      const signed = await this.signer.signEvent({
        kind: COMMUNITY_LIST_KIND,
        content,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });
      this.eventStore.add(signed);
      const stored = this.eventStore.getReplaceable(COMMUNITY_LIST_KIND, this.pubkey) ?? signed;
      // Seed the decryption cache with what we just encrypted, so re-reading our
      // own freshly-published list never round-trips the signer again.
      setHiddenContentCache(stored, plaintext);
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
    return resolveStanding(member, rt.keys.material.owner, rolesMap, state.grants);
  }

  canDo(cid: string, perm: bigint, targetPosition = 0xffffffff): boolean {
    const me = this.standingOf(cid, this.pubkey);
    return canActOn(me, { permissions: 0n, position: targetPosition, isOwner: false, roleIds: [] }, perm);
  }
}
