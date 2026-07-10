// ConcordCommunity — the single-community reactive engine.
//
// A thin wrapper that connects the Concord parts (crypto/keys, the stream
// envelope, the plane RumorStores + fold models, factories/operations, and the
// NIP-42 stream-key authenticator) for ONE community. It owns no fold logic:
// every piece of derived state comes from a model over a RumorStore. The engine
// only derives keys, routes decoded wraps into the right plane store, runs the
// epoch-atomic sync, and publishes.

import { BehaviorSubject, Subscription, combineLatest, map } from "rxjs";
import { EventStore, RumorStore } from "applesauce-core";
import { finalizeEvent, kinds, type EventTemplate, type NostrEvent } from "applesauce-core/helpers/event";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { ChatMessageFactory, CommentFactory, ForumThreadFactory, ReactionFactory } from "applesauce-common/factories";
import { DeleteFactory, type Emoji } from "applesauce-core/factories";
import type { ISigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";

import type { ConcordRelayAuth } from "./relay-auth.js";
import {
  addChannelKey,
  buildChannelRekey,
  buildRefounding,
  channelEpochOf,
  deriveConcordKeys,
  readRekey,
  wrapForTarget,
  type ConcordKeys,
  type PlaneInfo,
  type WrapTarget,
} from "../helpers/keys.js";
import type { GroupKey } from "../helpers/crypto.js";
import { EPHEMERAL_GIFT_WRAP_KIND, GIFT_WRAP_KIND, decodeWrapCached } from "../helpers/gift-wrap.js";
import { CONTROL_KIND, foldControl } from "../helpers/control.js";
import { checkChatBinding } from "../helpers/chat.js";
import { VOICE_PRESENCE_KIND } from "../helpers/voice.js";
import { canActOn, refoundAuthority, resolveStanding, type Standing } from "../helpers/permissions.js";
import { banlistLocator, grantLocator, inviteLinksLocator } from "../helpers/crypto.js";
import { computeEditionHash } from "../helpers/editions.js";
import type { AttachmentEncryption, MediaAttachment } from "../helpers/imeta.js";
import { STOCK_RELAYS, buildInviteBundle, buildInviteLink, newInviteToken } from "../helpers/invite-bundle.js";
import { EditFactory } from "../factories/edit.js";
import { DissolutionFactory, EditionFactory } from "../factories/control.js";
import { JoinLeaveFactory, KickFactory } from "../factories/guestbook.js";
import { InviteBundleFactory } from "../factories/invite-bundle.js";
import { DirectInviteFactory } from "../factories/direct-invite.js";
import { bindToChannel, includeMediaEncryption, type MediaEncryption } from "../operations/channel.js";
import { ConcordCommunityStateModel } from "../models/community.js";
import { decodedFromRumor } from "../models/utils.js";
import {
  PERM,
  VSK,
  type BlobPointer,
  type ChannelKey,
  type CommunityMetadata,
  type CommunityState,
  type DecodedEvent,
  type InviteBundle,
  type JoinMaterial,
  type Role,
  type RoleScope,
} from "../types.js";
import { planeStoreKey, syncAuthors, syncEpochs, type SyncContext } from "./sync.js";
import { ConcordPrivateChannel } from "./private-channel.js";
import type { ConcordRumorStore, ConcordStoreFactory, ConcordUploader } from "./storage.js";

/** Options for constructing a single-community {@link ConcordCommunity} engine. */
export interface ConcordCommunityOptions {
  /** The membership/key material for this community (from an invite or the list). */
  material: JoinMaterial;
  /** The logged-in user's signer (NIP-44 required to follow Refoundings). */
  signer: ISigner;
  /** The logged-in user's hex pubkey. */
  pubkey: string;
  /** The applesauce RelayPool used for all subscriptions/publishes. */
  pool: RelayPool;
  /** NIP-42 stream-key authenticator (shared across communities by the manager). */
  relayAuth: ConcordRelayAuth;
  /** Wrap-level store for kind-1059 dedup + the NIP-77 negentropy local store.
   *  Defaults to a fresh {@link EventStore}. */
  eventStore?: EventStore;
  /** Media uploader (encrypt + upload). Required to send files or set images. */
  uploader?: ConcordUploader;
  /** Fallback relays when the community defines none. */
  relays?: string[];
  /** Per-plane store factory (persistent cache). Defaults to in-memory stores. */
  storeFactory?: ConcordStoreFactory;
  /** Called whenever `material` changes (a fresh private-channel key, a Refounding)
   *  so the manager can persist it and refresh the Community List. */
  onMaterialChange?: (material: JoinMaterial) => void;
  /** Called when a Refounding excludes us (CORD-06): the manager tombstones the
   *  membership and drops the community. */
  onRemoved?: (communityId: string) => void;
}

function emptyState(material: JoinMaterial): CommunityState {
  return {
    material,
    channels: [],
    roles: [],
    grants: new Map(),
    banlist: new Set(),
    inviteLinks: new Set(),
    members: new Set(),
    dissolved: false,
  };
}

export class ConcordCommunity {
  readonly signer: ISigner;
  readonly pubkey: string;
  /** The current folded community state (channels, roles, members, …). */
  readonly state$: BehaviorSubject<CommunityState>;

  private readonly pool: RelayPool;
  private readonly relayAuth: ConcordRelayAuth;
  private readonly eventStore: EventStore;
  private readonly uploader?: ConcordCommunityOptions["uploader"];
  private readonly defaultRelays: string[];
  private readonly storeFactory: ConcordStoreFactory;
  private readonly onMaterialChange?: (material: JoinMaterial) => void;
  private readonly onRemoved?: (communityId: string) => void;

  /** The current key state; rolled forward on a Refounding. */
  private keys: ConcordKeys;
  /** planeKey ("control"|"guestbook"|"dissolved"|"rekey"|`channel:<id>`) → store. */
  private readonly stores = new Map<string, ConcordRumorStore>();
  /** channelId → the sub-community engine for each private channel we hold a key for. */
  private readonly privateChannels = new Map<string, ConcordPrivateChannel>();

  private stateSub?: Subscription;
  private liveSub?: Subscription;
  private authDrivers = new Subscription();
  private seenRelays = new Set<string>();
  private liveAuthors = "";
  private rekeyTimer?: ReturnType<typeof setTimeout>;
  private rekeyHandled = new Set<number>();
  private started = false;
  private disposed = false;

  constructor(options: ConcordCommunityOptions) {
    this.signer = options.signer;
    this.pubkey = options.pubkey;
    this.pool = options.pool;
    this.relayAuth = options.relayAuth;
    this.eventStore = options.eventStore ?? new EventStore();
    this.uploader = options.uploader;
    this.defaultRelays = options.relays?.length ? options.relays : STOCK_RELAYS;
    this.storeFactory = options.storeFactory ?? (() => new RumorStore());
    this.onMaterialChange = options.onMaterialChange;
    this.onRemoved = options.onRemoved;

    this.keys = deriveConcordKeys(options.material, []);
    this.state$ = new BehaviorSubject<CommunityState>(emptyState(options.material));

    // Eagerly create the community planes so the state model has stores to fold
    // and the (cached) history renders immediately, before sync fills the delta.
    this.storeFor("control");
    this.storeFor("guestbook");
    this.storeFor("dissolved");
    this.storeFor("rekey");
    this.rewireState();
  }

  get material(): JoinMaterial {
    return this.keys.material;
  }

  get communityId(): string {
    return this.keys.material.community_id;
  }

  // ---- lifecycle ----------------------------------------------------------

  /** Walk every epoch to the tip (auth → full-sync each plane → fold → rekey),
   *  then open a live subscription at the latest epoch. */
  async start(): Promise<void> {
    if (this.started || this.disposed) return;
    this.started = true;
    const walk = await syncEpochs(this.syncContext(), this.material);
    if (this.disposed) return;
    if (walk.removed) {
      this.handleRemoved();
      return;
    }
    if (walk.tipKeys) {
      this.keys = walk.tipKeys;
      this.openLive();
      if (this.keys.material !== this.state$.value.material) this.onMaterialChange?.(this.keys.material);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stateSub?.unsubscribe();
    this.liveSub?.unsubscribe();
    this.authDrivers.unsubscribe();
    if (this.rekeyTimer) clearTimeout(this.rekeyTimer);
    for (const engine of this.privateChannels.values()) engine.dispose();
    this.privateChannels.clear();
    for (const store of this.stores.values()) store.dispose();
    this.stores.clear();
  }

  /** The Control Plane {@link RumorStore} — fold it with `ConcordControlModel` &
   *  friends, or read editions directly with `.timeline([{ kinds: [3308] }])`. */
  get controlStore(): ConcordRumorStore {
    return this.storeFor("control");
  }

  /** The Guestbook Plane {@link RumorStore} (Joins/Leaves/Kicks/Snapshots). */
  get guestbookStore(): ConcordRumorStore {
    return this.storeFor("guestbook");
  }

  /** A channel's {@link RumorStore}. Consumers render messages themselves off the
   *  standard store API — e.g. `.timeline([{ kinds: [9] }])` for chat, or any
   *  applesauce model — so the engine carries no chat-fold logic. */
  channelStore(channelId: string): ConcordRumorStore {
    return this.storeFor(`channel:${channelId}`);
  }

  // ---- stores & state wiring ----------------------------------------------

  private storeFor(planeKey: string): ConcordRumorStore {
    let store = this.stores.get(planeKey);
    if (!store) {
      store = this.storeFactory(this.communityId, planeKey);
      this.stores.set(planeKey, store);
      // A newly-discovered channel store must join the observed-authors set.
      if (this.started) this.rewireState();
    }
    return store;
  }

  /** (Re)subscribe the folded community state over the current store set. The
   *  fold lives entirely in {@link ConcordCommunityStateModel}; here we only
   *  combine it with the tiny dissolved-plane signal and mirror to `state$`. */
  private rewireState(): void {
    this.stateSub?.unsubscribe();
    const control = this.storeFor("control");
    const guestbook = this.storeFor("guestbook");
    const dissolved = this.storeFor("dissolved");
    const observed = [...this.stores.values()];
    const state$ = control.model(ConcordCommunityStateModel, this.material, { guestbook, observed });
    const dissolved$ = dissolved
      .timeline([{}])
      .pipe(
        map((rumors) =>
          rumors.some(
            (r) => r.pubkey === this.material.owner && r.tags.some((t) => t[0] === "vsk" && t[1] === "10"),
          ),
        ),
      );
    this.stateSub = combineLatest([state$, dissolved$]).subscribe(([state, dissolved]) => {
      this.state$.next({ ...state, dissolved });
      if (this.started) this.reconcileLive(state.channels);
    });
  }

  // ---- routing (decode → plane store) -------------------------------------

  /** Decode a live gift wrap and route it (used by the live subscription and by
   *  the optimistic echo of our own publishes). */
  private onWrap(event: NostrEvent): void {
    const info = this.keys.planes.get(event.pubkey);
    if (!info) return;
    const canonical = (this.eventStore.add(event) as NostrEvent | null) ?? event;
    const decoded = decodeWrapCached(canonical, info.convKey);
    if (!decoded) return;
    this.route(info, decoded);
  }

  /** The single funnel: apply the CORD-03 receive binding + voice filter, then
   *  add the rumor to its plane store. Shared by sync and the live subscription. */
  private route(info: PlaneInfo, decoded: DecodedEvent): void {
    if (info.type === "channel") {
      const epoch = info.epoch ?? channelEpochOf(this.keys, info.channelId!);
      // CORD-03 §44: drop any rumor whose channel/epoch binding doesn't match the
      // key that opened the wrap (anti-replay), and voice presence (not chat).
      if (!checkChatBinding(decoded.rumor.tags, info.channelId!, epoch)) return;
      if (decoded.rumor.kind === VOICE_PRESENCE_KIND) return;
    }
    // `.add` is synchronous for an in-memory store and a Promise for an async-database-backed
    // one. Folded state derives reactively from the store's `insert$` (which fires once the add
    // resolves) and the folds are order-independent, so fire-and-forget is correct here — but
    // surface async-database errors rather than dropping them.
    Promise.resolve(this.storeFor(planeStoreKey(info)).add(decoded.rumor)).catch((err) =>
      console.error("[applesauce-concord] Failed to add rumor to plane store:", err),
    );
    if (info.type === "rekey") this.scheduleRekeyCheck();
  }

  // ---- sync context / subscriptions ---------------------------------------

  private relays(): string[] {
    return this.material.relays.length ? this.material.relays : this.defaultRelays;
  }

  private syncContext(): SyncContext {
    return {
      pool: this.pool,
      relayAuth: this.relayAuth,
      eventStore: this.eventStore,
      signer: this.signer,
      self: this.pubkey,
      relays: this.relays(),
      route: (info, decoded) => this.route(info, decoded),
      ensureAuth: (relays) => this.ensureAuth(relays),
      alive: () => !this.disposed,
    };
  }

  /** Register the per-relay NIP-42 auth drivers once per relay (idempotent). */
  private ensureAuth(relays: string[]): void {
    for (const url of relays) {
      if (this.seenRelays.has(url)) continue;
      this.seenRelays.add(url);
      this.authDrivers.add(this.relayAuth.authenticateStreamKeys(this.pool.relay(url)));
    }
  }

  /** The PUBLIC channel stream keys — private channels sync on their own engines. */
  private publicChannelKeys(): GroupKey[] {
    const publicIds = new Set(
      this.state$.value.channels.filter((c) => !c.private && !c.deleted).map((c) => c.channel_id),
    );
    return [...this.keys.channels.entries()].filter(([id]) => publicIds.has(id)).map(([, k]) => k);
  }

  /** The current-epoch stream pubkeys the community subscribes: core planes +
   *  PUBLIC channels only (private channels live on their sub-engines). */
  private currentAuthors(): string[] {
    const { control, guestbook, dissolved, nextBaseRekey } = this.keys;
    return [
      control.pk,
      guestbook.pk,
      dissolved.pk,
      nextBaseRekey.key.pk,
      ...this.publicChannelKeys().map((k) => k.pk),
    ];
  }

  /** Open (or reopen) the live subscription at the current epoch's addresses. */
  private openLive(): void {
    const authors = this.currentAuthors();
    const sig = [...authors].sort().join(",");
    if (sig === this.liveAuthors && this.liveSub) return;
    this.liveAuthors = sig;
    this.relayAuth.registerStreamKeys([
      this.keys.control,
      this.keys.guestbook,
      this.keys.dissolved,
      this.keys.nextBaseRekey.key,
      ...this.publicChannelKeys(),
    ]);
    this.ensureAuth(this.relays());
    this.liveSub?.unsubscribe();
    this.liveSub = this.pool
      .subscription(this.relays(), [{ kinds: [GIFT_WRAP_KIND, EPHEMERAL_GIFT_WRAP_KIND], authors }], {
        waitForAuth: authors,
      })
      .subscribe((event) => this.onWrap(event as NostrEvent));
  }

  /** A live state change may reveal a new channel. Derive every channel address
   *  (for routing), catch up freshly-revealed PUBLIC channels + reopen the live
   *  subscription, and spawn/dispose a {@link ConcordPrivateChannel} sub-engine for
   *  each private channel we hold a key for. */
  private reconcileLive(channels: CommunityState["channels"]): void {
    const before = new Set(this.keys.channels.keys());
    this.keys = deriveConcordKeys(this.material, channels, this.keys);

    // Public channels ride the community live sub — catch up any newly revealed.
    const publicIds = new Set(channels.filter((c) => !c.private && !c.deleted).map((c) => c.channel_id));
    const fresh = [...this.keys.channels.entries()]
      .filter(([id]) => publicIds.has(id) && !before.has(id))
      .map(([, k]) => k.pk);
    if (fresh.length > 0) {
      this.relayAuth.registerStreamKeys(this.publicChannelKeys());
      this.ensureAuth(this.relays());
      void syncAuthors(this.syncContext(), fresh).then((events) => {
        for (const ev of events) this.onWrap(ev);
      });
    }
    this.openLive();
    this.reconcilePrivateChannels(channels);
  }

  // ---- private channels (sub-community engines) ---------------------------

  /** Spawn a sub-engine for every private channel we hold a key for, and dispose
   *  those whose channel was deleted. */
  private reconcilePrivateChannels(channels: CommunityState["channels"]): void {
    const live = new Set<string>();
    for (const c of channels) {
      if (!c.private || c.deleted) continue;
      const key = this.material.channels.find((k) => k.id === c.channel_id);
      if (!key) continue; // a private channel we don't hold the key for — can't read it
      live.add(c.channel_id);
      if (!this.privateChannels.has(c.channel_id)) this.spawnPrivateChannel(key);
    }
    for (const [id, engine] of this.privateChannels) {
      if (live.has(id)) continue;
      engine.dispose();
      this.privateChannels.delete(id);
    }
  }

  /**
   * Merge channel keys delivered out-of-band — a Direct Invite / channel grant
   * (CORD-05 §6, see {@link grantChannelAccess}) — into our held material, then
   * spawn a sub-engine for each newly-granted private channel. Idempotent: keys we
   * already hold (by id) are ignored, so a redelivered grant is a no-op. A channel
   * whose metadata edition hasn't folded yet is picked up later by the next
   * {@link reconcileLive}. Returns true if anything new was merged.
   */
  receiveChannelKeys(keys: ChannelKey[]): boolean {
    const held = new Set(this.material.channels.map((c) => c.id));
    const fresh = keys.filter((k) => !held.has(k.id));
    if (fresh.length === 0) return false;
    const channels = [...this.material.channels, ...fresh];
    this.keys = deriveConcordKeys({ ...this.material, channels }, this.state$.value.channels, this.keys);
    this.onMaterialChange?.(this.keys.material);
    this.reconcilePrivateChannels(this.state$.value.channels);
    return true;
  }

  private spawnPrivateChannel(channelKey: ChannelKey): void {
    const engine = new ConcordPrivateChannel({
      channelKey,
      material: () => this.material,
      signer: this.signer,
      pubkey: this.pubkey,
      pool: this.pool,
      relayAuth: this.relayAuth,
      eventStore: this.eventStore,
      store: this.storeFor(`channel:${channelKey.id}`),
      relays: this.relays(),
      isAuthorized: (rotator) => this.hasPerm(rotator, PERM.MANAGE_CHANNELS),
      // A rotator may only remove US if they also strictly outrank us (CORD-04),
      // so an under-ranked channel manager can't rekey a higher-ranked member out.
      canRemoveSelf: (rotator) => this.hasPerm(rotator, PERM.MANAGE_CHANNELS, this.standingOf(this.pubkey).position),
      onKeyChange: (ck) => this.persistChannelKey(ck),
      onRemoved: (id) => this.onPrivateChannelRemoved(id),
    });
    this.privateChannels.set(channelKey.id, engine);
    void engine.start();
  }

  /** Persist a rolled-forward channel key into `material.channels` (a channel Rekey). */
  private persistChannelKey(channelKey: ChannelKey): void {
    const channels = this.material.channels.map((c) => (c.id === channelKey.id ? channelKey : c));
    this.keys = deriveConcordKeys({ ...this.material, channels }, this.state$.value.channels, this.keys);
    this.onMaterialChange?.(this.keys.material);
  }

  /** A channel Rekey excluded us: drop the sub-engine and our now-stale key (so we
   *  don't respawn an engine that just re-detects removal). Synced messages remain. */
  private onPrivateChannelRemoved(channelId: string): void {
    this.dropChannelKey(channelId);
  }

  /** Forget a private channel's key and dispose its sub-engine (idempotent). The
   *  shared teardown behind both an involuntary Rekey removal
   *  ({@link onPrivateChannelRemoved}) and a voluntary {@link leaveChannel}. */
  private dropChannelKey(channelId: string): void {
    const engine = this.privateChannels.get(channelId);
    if (engine) {
      engine.dispose();
      this.privateChannels.delete(channelId);
    }
    if (!this.material.channels.some((c) => c.id === channelId)) return;
    const channels = this.material.channels.filter((c) => c.id !== channelId);
    this.keys = deriveConcordKeys({ ...this.material, channels }, this.state$.value.channels, this.keys);
    this.onMaterialChange?.(this.keys.material);
  }

  /**
   * Voluntarily leave a private channel (CORD-03): drop our copy of the channel
   * key and dispose its sub-engine, then persist. Purely local — no rotation, so
   * the remaining members are undisturbed. Self-exclude via {@link rotateChannel}
   * is impossible (you can never strictly outrank yourself), so a local key-drop
   * is the only self-leave. Messages already synced to cache stay readable; new
   * channel traffic no longer decodes.
   */
  async leaveChannel(channelId: string): Promise<void> {
    this.dropChannelKey(channelId);
  }

  // ---- CORD-06 rekey read path (live adoption / removal) ------------------

  private scheduleRekeyCheck(): void {
    if (this.rekeyTimer) return;
    this.rekeyTimer = setTimeout(() => {
      this.rekeyTimer = undefined;
      void this.checkRekey();
    }, 200);
  }

  private async checkRekey(): Promise<void> {
    const state = this.state$.value;
    // `getTimeline` is sync for an in-memory store and a Promise for an async-database-backed one.
    const rekeyTimeline = await Promise.resolve(this.storeFor("rekey").getTimeline([{}]));
    const rekeyEvents = rekeyTimeline.map((rumor) => decodedFromRumor(rumor));
    const outcome = await readRekey(
      this.keys,
      rekeyEvents,
      refoundAuthority(state),
      this.pubkey,
      this.signer,
      state.channels,
    );
    if (outcome.kind === "none" || this.disposed) return;
    if (this.rekeyHandled.has(outcome.epoch)) return;
    this.rekeyHandled.add(outcome.epoch);
    if (outcome.kind === "adopt") this.adoptRefounding(outcome.next);
    else this.handleRemoved();
  }

  /** Follow a Refounding forward: swap in the rolled-forward key state, reopen the
   *  live subscription at the new epoch's addresses, and re-walk each private
   *  channel — a Refounding may bundle a channel Rekey sealed under the prior root
   *  (CORD-06 §94) and the channel-rekey address keys on the (now-changed) root. */
  private adoptRefounding(next: ConcordKeys): void {
    this.keys = next;
    this.openLive();
    this.onMaterialChange?.(this.keys.material);
    for (const engine of this.privateChannels.values()) void engine.refreshForCommunityEpoch();
  }

  private handleRemoved(): void {
    const cid = this.communityId;
    this.dispose();
    this.onRemoved?.(cid);
  }

  // ---- editions (control-plane versioned entities) ------------------------

  private async latestEdition(eid: string): Promise<{ version: number; hash: string; content: string } | undefined> {
    let best: { version: number; hash: string; content: string } | undefined;
    // `getByFilters` is synchronous for an in-memory store and a Promise for an
    // async-database-backed one — `Promise.resolve` normalizes both.
    const rumors = await Promise.resolve(this.storeFor("control").getByFilters([{ kinds: [CONTROL_KIND] }]));
    for (const rumor of rumors) {
      if (rumor.tags.find((t) => t[0] === "eid")?.[1] !== eid) continue;
      const version = parseInt(rumor.tags.find((t) => t[0] === "ev")?.[1] ?? "1", 10);
      if (!best || version > best.version) {
        const prev = rumor.tags.find((t) => t[0] === "ep")?.[1];
        const hash = computeEditionHash({ vsk: 0, eid, version, prevHash: prev, content: rumor.content });
        best = { version, hash, content: rumor.content };
      }
    }
    return best;
  }

  private async buildVac(actor: string): Promise<[string, string, string] | undefined> {
    if (actor === this.material.owner) return undefined;
    const eid = grantLocator(hexToBytes(this.material.community_id), actor);
    const latest = await this.latestEdition(eid);
    if (!latest) return undefined;
    return [eid, String(latest.version), latest.hash];
  }

  private async publishEdition(vsk: number, eid: string, content: string): Promise<void> {
    const latest = await this.latestEdition(eid);
    const version = latest ? latest.version + 1 : 1;
    const vac = await this.buildVac(this.pubkey);
    const rumor = await EditionFactory.create({ vsk, eid, version, prevHash: latest?.hash, content, vac });
    await this.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
  }

  // ---- chat actions -------------------------------------------------------

  private channelEpoch(channelId: string): number {
    return channelEpochOf(this.keys, channelId);
  }

  /** Publish ANY event to a channel (CORD-03) — a factory promise, a template, or
   *  a signed event. The channel/epoch binding + ms ordering are appended before
   *  the rumor is sealed + wrapped. */
  async sendEvent(
    channelId: string,
    source: PromiseLike<EventTemplate> | EventTemplate,
    opts: { plaintext?: boolean; ephemeral?: boolean } = {},
  ): Promise<string> {
    const epoch = this.channelEpoch(channelId);
    const rumor = await bindToChannel(channelId, epoch)(await source);
    return this.publishToPlane({ plane: "channel", channelId }, rumor, opts);
  }

  async sendMessage(
    channelId: string,
    text: string,
    replyTo?: { id: string; author: string },
    files?: Blob[],
    emojis?: Emoji[],
  ): Promise<void> {
    const epoch = this.channelEpoch(channelId);
    let content = text;
    let attachments: MediaAttachment[] | undefined;
    if (files?.length) {
      if (!this.uploader) throw new Error("no uploader configured: cannot send file attachments");
      attachments = [];
      for (const file of files) {
        const attachment = await this.uploader.upload(file, this.communityId);
        if (!attachment.url) throw new Error("uploader did not return a url");
        attachments.push(attachment);
        content = content ? `${content}\n${attachment.url}` : attachment.url;
      }
    }

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
    await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
  }

  /** Post a NIP-7D forum thread (kind 11) to a channel. */
  async sendThread(channelId: string, title: string, body = ""): Promise<void> {
    const epoch = this.channelEpoch(channelId);
    const rumor = await bindToChannel(channelId, epoch)(await ForumThreadFactory.create(title, body));
    await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
  }

  /** Reply to a channel thread with a NIP-22 kind 1111 comment (NIP-7D). */
  async replyToThread(channelId: string, thread: { id: string; author: string }, body: string): Promise<void> {
    const epoch = this.channelEpoch(channelId);
    const pointer = { type: "event" as const, id: thread.id, kind: kinds.ForumThread, pubkey: thread.author };
    const rumor = await bindToChannel(channelId, epoch)(await CommentFactory.create(pointer, body));
    await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
  }

  async react(channelId: string, target: { id: string; author: string }, reaction: string | Emoji): Promise<void> {
    const epoch = this.channelEpoch(channelId);
    const rumor = await bindToChannel(
      channelId,
      epoch,
    )(await ReactionFactory.create({ id: target.id, pubkey: target.author, kind: kinds.ChatMessage }, reaction));
    await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
  }

  async editMessage(channelId: string, targetId: string, text: string): Promise<void> {
    const epoch = this.channelEpoch(channelId);
    const rumor = await bindToChannel(channelId, epoch)(await EditFactory.create(targetId, text));
    await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
  }

  async deleteMessage(channelId: string, targetId: string): Promise<void> {
    const epoch = this.channelEpoch(channelId);
    const rumor = await bindToChannel(channelId, epoch)(await DeleteFactory.fromEvents([targetId]));
    await this.publishToPlane({ plane: "channel", channelId }, rumor, {});
  }

  // ---- admin actions ------------------------------------------------------

  async editMetadata(patch: Partial<CommunityMetadata>): Promise<void> {
    const current = this.state$.value.metadata ?? { name: this.material.name, relays: this.material.relays };
    const next: CommunityMetadata = { ...current, ...patch };
    await this.publishEdition(VSK.METADATA, this.material.community_id, JSON.stringify(next));
  }

  /** Encrypt an image via the uploader and publish it as the icon or banner. */
  async setCommunityImage(which: "icon" | "banner", file: Blob): Promise<void> {
    if (!this.uploader) throw new Error("no uploader configured: cannot set community image");
    const att = await this.uploader.upload(file, this.communityId);
    if (!att.encryption || !att.originalSha256 || !att.url)
      throw new Error("uploader did not return an encrypted attachment");
    const pointer: BlobPointer = {
      url: att.url,
      key: att.encryption.key,
      nonce: att.encryption.nonce,
      hash: att.originalSha256,
    };
    await this.editMetadata({ [which]: pointer });
  }

  async removeCommunityImage(which: "icon" | "banner"): Promise<void> {
    await this.editMetadata({ [which]: undefined });
  }

  async createChannel(name: string, isPrivate: boolean, voice = false): Promise<string> {
    const channelId = bytesToHex(generateSecretKey());
    if (isPrivate) {
      // A private channel mints its own key; persist it (else it's lost on reload).
      this.keys = addChannelKey(this.keys, channelId, name);
      this.onMaterialChange?.(this.keys.material);
    }
    const content: Record<string, unknown> = { name, private: isPrivate };
    if (voice) content.voice = true;
    await this.publishEdition(VSK.CHANNEL, channelId, JSON.stringify(content));
    return channelId;
  }

  async deleteChannel(channelId: string): Promise<void> {
    const ch = this.state$.value.channels.find((c) => c.channel_id === channelId);
    if (!ch) return;
    await this.publishEdition(
      VSK.CHANNEL,
      channelId,
      JSON.stringify({ name: ch.name, private: ch.private, deleted: true }),
    );
  }

  /**
   * Mint a Role (CORD-04 §2). A server-scoped role (the default) grants rank
   * community-wide; a channel-scoped role (`{kind:"channel", channel_id}`) is the
   * spec's private-channel membership marker — its grant-holders are the intended
   * readership of that channel, kept in sync with key possession by the caller
   * (deliver on grant via {@link grantChannelAccess}, rekey on removal via
   * {@link rotateChannel}). A role mints no key, so this only records entitlement.
   */
  async createRole(
    name: string,
    position: number,
    permissions: bigint,
    scope: RoleScope = { kind: "server" },
  ): Promise<string> {
    const roleId = bytesToHex(generateSecretKey());
    const role: Role = {
      role_id: roleId,
      name,
      position,
      permissions: permissions.toString(),
      scope,
      color: 0,
    };
    await this.publishEdition(VSK.ROLE, roleId, JSON.stringify(role));
    return roleId;
  }

  async grantRoles(member: string, roleIds: string[]): Promise<void> {
    const eid = grantLocator(hexToBytes(this.material.community_id), member);
    await this.publishEdition(VSK.GRANT, eid, JSON.stringify({ member, role_ids: roleIds }));
  }

  async kick(member: string): Promise<void> {
    await this.grantRoles(member, []);
    const vac = await this.buildVac(this.pubkey);
    await this.publishToPlane({ plane: "guestbook" }, await KickFactory.create(member, vac), {});
  }

  async ban(member: string): Promise<void> {
    const current = new Set(this.state$.value.banlist);
    current.add(member);
    const eid = banlistLocator(hexToBytes(this.material.community_id));
    await this.publishEdition(VSK.BANLIST, eid, JSON.stringify([...current]));
    await this.grantRoles(member, []);
    // NOTE: full enforcement also requires a Refounding (rekey) — CORD-06.
  }

  async unban(member: string): Promise<void> {
    const current = new Set(this.state$.value.banlist);
    current.delete(member);
    const eid = banlistLocator(hexToBytes(this.material.community_id));
    await this.publishEdition(VSK.BANLIST, eid, JSON.stringify([...current]));
  }

  /**
   * Channel-scoped Rekey (CORD-06): rotate a private channel's key to sever the
   * excluded members, delivering the new key only to `keep`. Requires
   * `MANAGE_CHANNELS`. The new key is persisted into `material.channels` once the
   * channel's sub-engine adopts the rotation.
   */
  async rotateChannel(channelId: string, opts: { keep: string[]; exclude?: string[] }): Promise<void> {
    const channelKey = this.material.channels.find((c) => c.id === channelId);
    if (!channelKey) throw new Error("not a private channel we hold a key for");
    if (!this.canDo(PERM.MANAGE_CHANNELS)) throw new Error("need MANAGE_CHANNELS to rekey a channel");

    // CORD-04: excluding a member is acting on them — the rotator must strictly
    // outrank each one, not merely hold MANAGE_CHANNELS.
    for (const target of opts.exclude ?? []) {
      if (!this.canDo(PERM.MANAGE_CHANNELS, this.standingOf(target).position))
        throw new Error(`cannot exclude ${target} from the channel — you do not outrank them`);
    }

    const excluded = new Set(opts.exclude ?? []);
    const recipients = [...new Set([this.pubkey, ...opts.keep])].filter((pk) => !excluded.has(pk));
    const plan = await buildChannelRekey(this.material, channelKey, this.signer, { recipients, self: this.pubkey });

    const relays = this.relays();
    for (const wrap of plan.rekeyWraps)
      await this.pool.publish(relays, wrap).catch((err) => console.warn("channel rekey publish failed", err));

    // Optimistically hand the rekey to the channel's sub-engine so it adopts the
    // new key immediately (which persists it via onKeyChange); fall back to
    // persisting directly if no sub-engine is running yet.
    const engine = this.privateChannels.get(channelId);
    if (engine) for (const wrap of plan.rekeyWraps) engine.ingest(wrap);
    else this.persistChannelKey(plan.next);
  }

  async dissolve(): Promise<void> {
    if (this.pubkey !== this.material.owner) throw new Error("only the owner can dissolve");
    await this.publishToPlane({ plane: "dissolved" }, await DissolutionFactory.create(), { plaintext: true });
  }

  /** Publish our Leave and tear the community down. The manager tombstones the
   *  membership in the Community List. */
  async leave(): Promise<void> {
    await this.publishToPlane({ plane: "guestbook" }, await JoinLeaveFactory.create("leave"), {});
    this.dispose();
  }

  // ---- invites ------------------------------------------------------------

  async createInvite(base: string): Promise<string> {
    const token = newInviteToken();
    const linkSk = generateSecretKey();
    const linkPub = getPublicKey(linkSk);

    const state = this.state$.value;
    const bundle = buildInviteBundle(this.material, {
      name: state.metadata?.name,
      icon: state.metadata?.icon,
      creator_npub: this.pubkey,
    });

    const template = await InviteBundleFactory.create(bundle, token);
    const signed = finalizeEvent(template, linkSk);
    this.eventStore.add(signed);
    const inviteRelays = this.relays();
    this.pool.publish(inviteRelays, signed).catch((err) => console.warn("bundle publish failed", err));

    // Register the link into the community (CORD-05 §5) so it counts as Public.
    const registryEid = inviteLinksLocator(hexToBytes(this.material.community_id), this.pubkey);
    const existing = await this.latestEdition(registryEid);
    let links: string[] = [];
    try {
      if (existing) links = JSON.parse(existing.content) as string[];
    } catch {
      /* ignore */
    }
    if (!links.includes(linkPub)) links.push(linkPub);
    await this.publishEdition(VSK.INVITE_REGISTRY, registryEid, JSON.stringify(links));

    return buildInviteLink(base, linkPub, token, inviteRelays);
  }

  /**
   * Grant a specific member access to ONE private channel we hold (CORD-05 §6 /
   * CORD-03: "delivered on grant"). Hands over the channel's CURRENT `(key, epoch)`
   * — plus any held prior keys, so they read recent history — via a Direct Invite
   * gift-wrapped to `member`. This is the spec-correct way to ADD someone: no
   * rotation and no epoch bump (rotations sever, and a {@link rotateChannel} can
   * never onboard a new holder — its continuity check requires the prior key).
   * The bundle carries only this one channel key (never the caller's other private
   * channels). Requires `MANAGE_CHANNELS`. Publish is best-effort to the community
   * relays, where the recipient's Direct-Invite watcher also listens.
   */
  async grantChannelAccess(channelId: string, member: string): Promise<void> {
    const channelKey = this.material.channels.find((c) => c.id === channelId);
    if (!channelKey) throw new Error("not a private channel we hold a key for");
    if (!this.canDo(PERM.MANAGE_CHANNELS)) throw new Error("need MANAGE_CHANNELS to grant channel access");

    const state = this.state$.value;
    const bundle: InviteBundle = {
      ...buildInviteBundle(this.material, {
        name: state.metadata?.name,
        icon: state.metadata?.icon,
        creator_npub: this.pubkey,
      }),
      // Only THIS channel travels — buildInviteBundle would otherwise carry every
      // private channel we hold, over-granting the recipient.
      channels: [
        {
          id: channelKey.id,
          key: channelKey.key,
          epoch: channelKey.epoch,
          name: channelKey.name,
          ...(channelKey.held ? { held: channelKey.held } : {}),
        },
      ],
    };

    const wrap = await DirectInviteFactory.create(bundle, member, this.signer);
    this.eventStore.add(wrap);
    await this.pool.publish(this.relays(), wrap).catch((err) => console.warn("channel grant publish failed", err));
  }

  // ---- CORD-06 refounding (rekey) -----------------------------------------

  /**
   * Rebuild the Control-Plane heads WITH their re-wrappable plaintext seals, for
   * Refounding compaction (CORD-06 §2). The folded `CommunityState.heads` come
   * from the RumorStore, which persists only the inner rumor — the seal is
   * stripped (`decodedFromRumor`), so those heads carry no `seal` and
   * `buildRefounding` would skip compaction entirely. The original seals survive
   * in the wrap-level `eventStore`, so decode the control-plane wraps (current +
   * every held epoch) back into full `DecodedEvent`s and re-fold to recover the
   * current head set with seals intact.
   */
  private controlHeadsWithSeals(): DecodedEvent[] {
    const decoded: DecodedEvent[] = [];
    for (const [pk, info] of this.keys.planes) {
      if (info.type !== "control") continue;
      for (const wrap of this.eventStore.getByFilters([{ kinds: [GIFT_WRAP_KIND], authors: [pk] }])) {
        const d = decodeWrapCached(wrap, info.convKey);
        if (d) decoded.push(d);
      }
    }
    return [...(foldControl(decoded, this.material).heads?.values() ?? [])];
  }

  async refound(opts: {
    keep: string[];
    exclude?: string[];
    /**
     * Per-private-channel keep lists (CORD-06 §94). ONLY the named channels are
     * rotated, and each new channel key is delivered ONLY to its own `keep` set —
     * pass a channel's actual membership, never the community-wide keep set, or a
     * member who was never in the channel would be granted its key. Unnamed
     * private channels are left untouched: the excluded retain their existing
     * channel key until a separate {@link rotateChannel}.
     */
    channelRekeys?: Array<{ channelId: string; keep: string[] }>;
  }): Promise<void> {
    const state = this.state$.value;
    if (!refoundAuthority(state)(this.pubkey)) throw new Error("need BAN or ownership to refound");

    const excluded = new Set(opts.exclude ?? []);
    const recipients = [...new Set([this.pubkey, ...opts.keep])].filter((pk) => !excluded.has(pk));
    const relays = this.relays();

    // Bundle a channel Rekey ONLY for the explicitly-named private channels, each
    // delivered to that channel's own membership (CORD-06 §94). Delivering to the
    // community keep set would over-grant — a kept member who was never in a
    // private channel would receive its key — so scoping is the caller's to supply.
    const channelRekeys = (opts.channelRekeys ?? []).flatMap(({ channelId, keep }) => {
      const channel = this.material.channels.find((c) => c.id === channelId);
      if (!channel) return [];
      const recips = [...new Set([this.pubkey, ...keep])].filter((pk) => !excluded.has(pk));
      return [{ channel, recipients: recips }];
    });

    const plan = await buildRefounding(this.keys, this.signer, {
      recipients,
      self: this.pubkey,
      heads: this.controlHeadsWithSeals(),
      channels: state.channels,
      channelRekeys,
    });

    // Rekey blobs (root + channels) gate convergence, so land them first.
    for (const wrap of plan.rekeyWraps) {
      await this.pool.publish(relays, wrap).catch((err) => console.warn("rekey publish failed", err));
    }
    for (const wrap of plan.channelRekeyWraps) {
      await this.pool.publish(relays, wrap).catch((err) => console.warn("channel rekey publish failed", err));
    }
    for (const wrap of plan.compactionWraps) this.pool.publish(relays, wrap).catch(() => {});
    for (const wrap of plan.snapshotWraps) this.pool.publish(relays, wrap).catch(() => {});

    this.rekeyHandled.add(plan.newEpoch);
    this.adoptRefounding(plan.next);
  }

  // ---- publishing ---------------------------------------------------------

  /** Seal + wrap a rumor onto a plane, echo it locally, and publish it. For a
   *  channel prefer {@link sendEvent}, which appends the CORD-03 binding; this is
   *  the raw plane path used for control/guestbook seeding (genesis, Join). */
  async publishToPlane(
    target: WrapTarget,
    rumor: { kind: number; content: string; tags: string[][]; created_at?: number },
    opts: { plaintext?: boolean; ephemeral?: boolean } = {},
  ): Promise<string> {
    const { wrap, rumorId } = await wrapForTarget(this.keys, target, this.signer, rumor, opts);
    // Optimistic local echo first, so the UI updates before relays ack.
    if (!opts.ephemeral) this.onWrap(wrap);
    this.pool.publish(this.relays(), wrap).catch((err) => console.warn("publish failed", err));
    return rumorId;
  }

  // ---- helpers for UI -----------------------------------------------------

  standingOf(member: string): Standing {
    const state = this.state$.value;
    const rolesMap = new Map<string, Role>(state.roles.map((r) => [r.role_id, r]));
    return resolveStanding(member, this.material.owner, rolesMap, state.grants);
  }

  canDo(perm: bigint, targetPosition = 0xffffffff): boolean {
    return this.hasPerm(this.pubkey, perm, targetPosition);
  }

  /** Whether `member` holds `perm` (the roster authority check, e.g. for accepting
   *  a channel Rekey from a rotator). */
  private hasPerm(member: string, perm: bigint, targetPosition = 0xffffffff): boolean {
    const standing = this.standingOf(member);
    return canActOn(standing, { permissions: 0n, position: targetPosition, isOwner: false, roleIds: [] }, perm);
  }
}
