// ConcordCommunity — the single-community reactive engine.
//
// A thin wrapper that connects the Concord parts (crypto/keys, the stream
// envelope, the plane RumorStores + fold models, factories/operations, and the
// NIP-42 stream-key authenticator) for ONE community. It owns no fold logic:
// every piece of derived state comes from a model over a RumorStore. The engine
// only derives keys, routes decoded wraps into the right plane store, runs the
// epoch-atomic sync, and publishes.

import { BehaviorSubject, Observable, Subscription, combineLatest, distinctUntilChanged, map, shareReplay } from "rxjs";
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
import { foldControl } from "../helpers/control.js";
import { checkChatBinding } from "../helpers/chat.js";
import { VOICE_PRESENCE_KIND } from "../helpers/voice.js";
import { refoundAuthority, type Standing } from "../helpers/permissions.js";
import type { AttachmentEncryption, MediaAttachment } from "../helpers/imeta.js";
import { STOCK_RELAYS, buildInviteBundle, buildInviteLink, newInviteToken } from "../helpers/invite-bundle.js";
import { EditFactory } from "../factories/edit.js";
import { DissolutionFactory } from "../factories/control.js";
import { JoinLeaveFactory, KickFactory } from "../factories/guestbook.js";
import { InviteBundleFactory } from "../factories/invite-bundle.js";
import { DirectInviteFactory } from "../factories/direct-invite.js";
import { bindToChannel, includeMediaEncryption, type MediaEncryption } from "../operations/channel.js";
import { ConcordCommunityStateModel } from "../models/community.js";
import { decodedFromRumor } from "../models/utils.js";
import {
  PERM,
  type ChannelKey,
  type ChannelMetadata,
  type CommunityMetadata,
  type CommunityState,
  type ConcordCommunityStatus,
  type ConcordSyncPhase,
  type DecodedEvent,
  type InviteBundle,
  type JoinMaterial,
  type Role,
  type RoleScope,
} from "../types.js";
import { planeStoreKey, syncAuthors, syncEpochs, type SyncContext } from "./sync.js";
import { ConcordCommunityAdmin, type CreateChannelOptions } from "./admin.js";
import { ConcordPrivateChannel } from "./private-channel.js";
import type { ConcordRumorStore, ConcordStoreFactory, ConcordUploader, ConcordUploadProgress } from "./storage.js";
import type { ConcordInviteLink, CreateInviteOptions } from "./invite-manager.js";

export interface ConcordSendMessageOptions {
  onUploadProgress?: (progress: ConcordUploadProgress) => void;
}

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
  /** Called after a public invite link has been minted and registered so the
   *  owning client can persist it into the user's private Invite List (13303). */
  onInviteCreated?: (invite: ConcordInviteLink) => void | Promise<void>;
  /** Called after a public invite link has been revoked so the owning client can
   *  persist the terminal tombstone into the user's private Invite List (13303). */
  onInviteRevoked?: (invite: ConcordInviteLink) => void | Promise<void>;
  /** Called after a Refounding rolls the community_root so the owning client can
   *  refresh every live invite bundle behind its unchanged URL (CORD-05 §2). */
  onRefounded?: (communityId: string) => void;
}

/** Content equality for the member/ban sets, which are rebuilt on every fold. */
function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}

function sameStanding(a: Standing, b: Standing): boolean {
  return (
    a.isOwner === b.isOwner &&
    a.position === b.position &&
    a.permissions === b.permissions &&
    a.roleIds.length === b.roleIds.length &&
    a.roleIds.every((id, i) => id === b.roleIds[i])
  );
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
  /** The current folded community state (channels, roles, members, …). The
   *  aggregate; prefer the granular reads below, which only emit when their own
   *  slice changes. */
  readonly state$: BehaviorSubject<CommunityState>;
  /** The community's metadata (name, description, icon, banner, relays). */
  readonly metadata$: Observable<CommunityMetadata | undefined>;
  /** The community's live (non-deleted) channels. */
  readonly channels$: Observable<ChannelMetadata[]>;
  /** The community's roles, ordered by position (highest authority first). */
  readonly roles$: Observable<Role[]>;
  /** member → role_ids. */
  readonly grants$: Observable<Map<string, string[]>>;
  /** The banned pubkeys. */
  readonly banlist$: Observable<Set<string>>;
  /** Live invite-link coordinates; non-empty ⇒ the community is Public (CORD-05 §5). */
  readonly inviteLinks$: Observable<Set<string>>;
  /** The community's members. */
  readonly members$: Observable<Set<string>>;
  /** The community's sync-lifecycle phase (idle → syncing → live; removed/error). */
  readonly phase$ = new BehaviorSubject<ConcordSyncPhase>("idle");
  /** The community's current root epoch (bumps on each adopted Refounding). */
  readonly epoch$: BehaviorSubject<number>;
  /** The last sync error message, or null. */
  readonly error$ = new BehaviorSubject<string | null>(null);
  /** Whether the owner has dissolved the community. */
  readonly dissolved$: Observable<boolean>;
  /** Whether any of the community's relays has an open socket. */
  readonly connected$: Observable<boolean>;
  /** Whether the community's stream keys are NIP-42-authenticated on every connected relay. */
  readonly authenticated$: Observable<boolean>;
  /** A flat snapshot of the community's status, for UI to react to as one value. */
  readonly status$: Observable<ConcordCommunityStatus>;

  /** Every action that requires authority — metadata, channels, roles, members,
   *  invites, refounding, dissolution — as one intent-shaped surface. This is the
   *  community-management API; prefer it over the flat aliases the community keeps
   *  for convenience. Nothing in it names a protocol plane. */
  readonly admin: ConcordCommunityAdmin;

  private readonly pool: RelayPool;
  private readonly relayAuth: ConcordRelayAuth;
  private readonly eventStore: EventStore;
  private readonly uploader?: ConcordCommunityOptions["uploader"];
  private readonly defaultRelays: string[];
  private readonly storeFactory: ConcordStoreFactory;
  private readonly onMaterialChange?: (material: JoinMaterial) => void;
  private readonly onRemoved?: (communityId: string) => void;
  private readonly onInviteCreated?: (invite: ConcordInviteLink) => void | Promise<void>;
  private readonly onInviteRevoked?: (invite: ConcordInviteLink) => void | Promise<void>;
  private readonly onRefounded?: (communityId: string) => void;

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
    this.onInviteCreated = options.onInviteCreated;
    this.onInviteRevoked = options.onInviteRevoked;
    this.onRefounded = options.onRefounded;

    this.keys = deriveConcordKeys(options.material, []);
    this.state$ = new BehaviorSubject<CommunityState>(emptyState(options.material));
    this.epoch$ = new BehaviorSubject<number>(options.material.root_epoch);

    this.dissolved$ = this.state$.pipe(
      map((s) => s.dissolved),
      distinctUntilChanged(),
    );

    // Granular reads. Every control-plane slice keeps a STABLE REFERENCE between
    // control folds — `ConcordCommunityStateModel` spreads `{ ...control, members }`,
    // so `state$` re-emitting because a chat message moved the observed-authors set
    // leaves `roles`/`channels`/… pointing at the same objects. Reference identity is
    // therefore enough to keep these quiet under channel traffic.
    const slice = <T>(select: (s: CommunityState) => T): Observable<T> =>
      this.state$.pipe(map(select), distinctUntilChanged());
    this.metadata$ = slice((s) => s.metadata);
    this.channels$ = slice((s) => s.channels);
    this.roles$ = slice((s) => s.roles);
    this.grants$ = slice((s) => s.grants);
    this.banlist$ = slice((s) => s.banlist);
    this.inviteLinks$ = slice((s) => s.inviteLinks);
    // `members` is rebuilt by every guestbook/presence fold, so compare by content.
    this.members$ = this.state$.pipe(
      map((s) => s.members),
      distinctUntilChanged(sameSet),
    );

    this.connected$ = this.relayAuth.connected$(this.relays());
    this.authenticated$ = this.relayAuth.authenticated$(this.relays(), () => this.currentAuthors());
    this.status$ = combineLatest({
      phase: this.phase$,
      epoch: this.epoch$,
      dissolved: this.dissolved$,
      connected: this.connected$,
      authenticated: this.authenticated$,
      error: this.error$,
    }).pipe(
      map(
        ({ dissolved, ...s }): ConcordCommunityStatus => ({
          ...s,
          phase: dissolved ? "dissolved" : s.phase,
        }),
      ),
      distinctUntilChanged(
        (a, b) =>
          a.phase === b.phase &&
          a.epoch === b.epoch &&
          a.connected === b.connected &&
          a.authenticated === b.authenticated &&
          a.error === b.error,
      ),
      shareReplay(1),
    );

    // Eagerly create the community planes so the state model has stores to fold
    // and the (cached) history renders immediately, before sync fills the delta.
    this.storeFor("control");
    this.storeFor(this.guestbookPlaneKey());
    this.storeFor("dissolved");
    this.storeFor("rekey");

    this.admin = new ConcordCommunityAdmin({
      community: this,
      store: this.storeFor("control"),
      state: () => this.state$.value,
      pubkey: this.pubkey,
      uploader: this.uploader,
      publish: (rumor) => this.publishToPlane({ plane: "control" }, rumor, { plaintext: true }),
      mintChannelKey: (channelId, name) => {
        this.keys = addChannelKey(this.keys, channelId, name);
        this.onMaterialChange?.(this.keys.material);
      },
    });

    this.rewireState();
  }

  get material(): JoinMaterial {
    return this.keys.material;
  }

  /** The current-epoch Guestbook store key (CORD-02 §5: the Guestbook rides the
   *  epoch) — mirrors `planeStoreKey`'s `guestbook@<epoch>` scheme in sync.ts. */
  private guestbookPlaneKey(): string {
    return `guestbook@${this.keys.material.root_epoch}`;
  }

  /**
   * D-03: dispose+delete any `guestbook@<epoch>` store whose epoch is no longer
   * live — neither the current epoch nor one of `held_roots`. Keys and stores
   * share one retention horizon: you can't decode an epoch you no longer hold the
   * root for (its address is unrecoverable), so its store is dead weight. Only
   * the guestbook plane is epoch-keyed this phase (control/dissolved/rekey/
   * channel are untouched) — called once per adopted Refounding, after the key
   * roll so `held_roots`/the current epoch are already current.
   */
  private trimStaleGuestbookStores(): void {
    const material = this.keys.material;
    const liveEpochs = new Set<number>([material.root_epoch, ...(material.held_roots ?? []).map((r) => r.epoch)]);
    for (const key of [...this.stores.keys()]) {
      if (!key.startsWith("guestbook@")) continue;
      const epoch = Number(key.slice("guestbook@".length));
      if (liveEpochs.has(epoch)) continue;
      this.stores.get(key)?.dispose();
      this.stores.delete(key);
    }
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
    this.phase$.next("syncing");
    try {
      const walk = await syncEpochs(this.syncContext(), this.material);
      if (this.disposed) return;
      if (walk.removed) {
        this.handleRemoved();
        return;
      }
      if (walk.tipKeys) {
        this.keys = walk.tipKeys;
        // A Refounding adopted during the walk advances material.refounder — rebind
        // the fold so the tip epoch's guestbook snapshot (kind 3312) is honored.
        this.rewireState();
        this.openLive();
        this.epoch$.next(this.keys.material.root_epoch);
        if (this.keys.material !== this.state$.value.material) this.onMaterialChange?.(this.keys.material);
      }
      this.error$.next(null);
      this.phase$.next("live");
    } catch (err) {
      if (this.disposed) return;
      this.error$.next(err instanceof Error ? err.message : String(err));
      this.phase$.next("error");
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

  /** The current-epoch Guestbook Plane {@link RumorStore} (Joins/Leaves/Kicks/
   *  Snapshots). The Guestbook rides the epoch (CORD-02 §5) — a Refounding's new
   *  epoch reads a fresh store; see {@link guestbookPlaneKey}. */
  get guestbookStore(): ConcordRumorStore {
    return this.storeFor(this.guestbookPlaneKey());
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
    const guestbook = this.storeFor(this.guestbookPlaneKey());
    const dissolved = this.storeFor("dissolved");
    // The live `observed` set is scoped to current-epoch guestbook (added by the
    // model itself, below) + channel activity only. Control/dissolved/rekey are
    // protocol/tombstone traffic, not "publishing" — excluding them also keeps the
    // control store from entangling the roster fold with observed-authorship
    // (Phase 8/9 territory). Public-channel stores stay un-epoch-scoped (continuous
    // chat history); a removed member's OLD public-channel activity is a known
    // residual DEFERRED to Phase 7 (channel epoch-keying) — see 06-RESEARCH.md
    // Open Question 1 and the community.test.ts regression test that pins it.
    const observed = [...this.stores.entries()].filter(([key]) => key.startsWith("channel:")).map(([, s]) => s);
    const state$ = control.model(ConcordCommunityStateModel, this.material, { guestbook, observed });
    const dissolved$ = dissolved
      .timeline([{}])
      .pipe(
        map((rumors) =>
          rumors.some((r) => r.pubkey === this.material.owner && r.tags.some((t) => t[0] === "vsk" && t[1] === "10")),
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
    return [control.pk, guestbook.pk, dissolved.pk, nextBaseRekey.key.pk, ...this.publicChannelKeys().map((k) => k.pk)];
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
      isAuthorized: (rotator) => this.admin.hasPerm(rotator, PERM.MANAGE_CHANNELS),
      // A rotator may only remove US if they also strictly outrank us (CORD-04),
      // so an under-ranked channel manager can't rekey a higher-ranked member out.
      canRemoveSelf: (rotator) =>
        this.admin.hasPerm(rotator, PERM.MANAGE_CHANNELS, this.standingOf(this.pubkey).position),
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
    this.trimStaleGuestbookStores();
    // Rebind the fold to the new epoch's refounder so foldMembers honors the new
    // epoch's guestbook snapshot (kind 3312) and the full memberlist carries over.
    this.rewireState();
    this.openLive();
    this.epoch$.next(this.keys.material.root_epoch);
    this.onMaterialChange?.(this.keys.material);
    for (const engine of this.privateChannels.values()) void engine.refreshForCommunityEpoch();
    // The root just rolled, so every live invite bundle now carries a stale
    // community_root. Ask the client to re-post them behind their unchanged URLs
    // (CORD-05 §2); it holds the per-link signer secrets, we don't.
    this.onRefounded?.(this.communityId);
  }

  private handleRemoved(): void {
    const cid = this.communityId;
    this.phase$.next("removed");
    this.dispose();
    this.onRemoved?.(cid);
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
    options: ConcordSendMessageOptions = {},
  ): Promise<void> {
    const epoch = this.channelEpoch(channelId);
    let content = text;
    let attachments: MediaAttachment[] | undefined;
    if (files?.length) {
      if (!this.uploader) throw new Error("no uploader configured: cannot send file attachments");
      attachments = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let phase: ConcordUploadProgress["phase"] = "encrypting";
        const emit = (next: ConcordUploadProgress["phase"]) => {
          phase = next;
          options.onUploadProgress?.({ total: files.length, done: i, phase });
        };
        emit("encrypting");
        const attachment = await this.uploader.upload(file, this.communityId, { onProgress: emit });
        if (!attachment.url) throw new Error("uploader did not return a url");
        attachments.push(attachment);
        options.onUploadProgress?.({ total: files.length, done: i + 1, phase });
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
  //
  // Each of these is a CORD-04 edition: the version/hash chain, the entity
  // coordinates, and the authority resolution all live in ConcordCommunityControl.
  // They stay exposed here so an app never has to know which plane an action lands
  // on — `kick` writes the guestbook, `ban` the control plane, and both read the
  // same to a caller.

  editMetadata(patch: Partial<CommunityMetadata>): Promise<void> {
    return this.admin.editMetadata(patch);
  }

  /** Encrypt an image via the uploader and publish it as the icon or banner. */
  setCommunityImage(which: "icon" | "banner", file: Blob): Promise<void> {
    return this.admin.setCommunityImage(which, file);
  }

  removeCommunityImage(which: "icon" | "banner"): Promise<void> {
    return this.admin.removeCommunityImage(which);
  }

  createChannel(name: string, options?: CreateChannelOptions): Promise<string> {
    return this.admin.createChannel(name, options);
  }

  deleteChannel(channelId: string): Promise<void> {
    return this.admin.deleteChannel(channelId);
  }

  /**
   * Mint a Role (CORD-04 §2). A server-scoped role (the default) grants rank
   * community-wide; a channel-scoped role (`{kind:"channel", channel_id}`) is the
   * spec's private-channel membership marker — its grant-holders are the intended
   * readership of that channel, kept in sync with key possession by the caller
   * (deliver on grant via {@link grantChannelAccess}, rekey on removal via
   * {@link rotateChannel}). A role mints no key, so this only records entitlement.
   */
  createRole(
    name: string,
    position: number,
    permissions: bigint,
    scope: RoleScope = { kind: "server" },
  ): Promise<string> {
    return this.admin.createRole(name, position, permissions, scope);
  }

  editRole(roleId: string, patch: Partial<Omit<Role, "role_id">>): Promise<void> {
    return this.admin.editRole(roleId, patch);
  }

  /**
   * Retire a Role (CORD-04). The role stays in {@link CommunityState.roles} flagged
   * `deleted` — so it remains visible and compactable — but confers no permissions
   * or rank, stripping its authority from every grant-holder. Reverse with
   * `editRole(roleId, { deleted: false })`. Existing grants are left untouched.
   */
  deleteRole(roleId: string): Promise<void> {
    return this.admin.deleteRole(roleId);
  }

  grantRoles(member: string, roleIds: string[]): Promise<void> {
    return this.admin.grantRoles(member, roleIds);
  }

  /** Strip a member's roles (control plane) and publish the Kick (guestbook). */
  async kick(member: string): Promise<void> {
    await this.admin.grantRoles(member, []);
    const vac = await this.admin.vacFor(this.pubkey);
    await this.publishToPlane({ plane: "guestbook" }, await KickFactory.create(member, vac), {});
  }

  ban(member: string): Promise<void> {
    return this.admin.ban(member);
  }

  unban(member: string): Promise<void> {
    return this.admin.unban(member);
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

  async createInvite(options: CreateInviteOptions): Promise<ConcordInviteLink> {
    const token = newInviteToken();
    const linkSk = generateSecretKey();
    const linkPub = getPublicKey(linkSk);

    const state = this.state$.value;
    const bundle = buildInviteBundle(this.material, {
      name: state.metadata?.name,
      icon: state.metadata?.icon,
      creator_npub: this.pubkey,
      label: options.label,
      expires_at: options.expiresAt,
      channels: options.channels,
    });

    const template = await InviteBundleFactory.create(bundle, token);
    const signed = finalizeEvent(template, linkSk);
    this.eventStore.add(signed);
    const inviteRelays = this.relays();
    this.pool.publish(inviteRelays, signed).catch((err) => console.warn("bundle publish failed", err));

    // Register the link into the community (CORD-05 §5) so it counts as Public.
    await this.admin.registerInviteLink(linkPub);

    const invite: ConcordInviteLink = {
      token: bytesToHex(token),
      signerSk: bytesToHex(linkSk),
      signerPubkey: linkPub,
      communityId: this.communityId,
      url: buildInviteLink(options.base, linkPub, token, inviteRelays),
      label: options.label,
      channels: options.channels,
      createdAt: Math.floor(Date.now() / 1000),
      expiresAt: options.expiresAt,
      revoked: false,
    };
    await this.onInviteCreated?.(invite);
    return invite;
  }

  /**
   * Re-post the given live invite bundles behind their unchanged URLs (CORD-05 §2).
   * Called after a Refounding: each bundle is rebuilt from the CURRENT material (the
   * fresh community_root, root_epoch, and channel keys) and re-signed under the same
   * `link_signer`, replacing the stale bundle at its coordinate (`d: ""`). The URL —
   * whose naddr is the link_signer pubkey and whose token is unchanged — keeps
   * opening, so a link shared once survives every rotation. Best-effort per link.
   */
  async refreshInviteBundles(links: ConcordInviteLink[]): Promise<void> {
    const state = this.state$.value;
    const inviteRelays = this.relays();
    for (const link of links) {
      const bundle = buildInviteBundle(this.material, {
        name: state.metadata?.name,
        icon: state.metadata?.icon,
        creator_npub: this.pubkey,
        label: link.label,
        expires_at: link.expiresAt,
        channels: link.channels,
      });
      const template = await InviteBundleFactory.create(bundle, hexToBytes(link.token));
      const signed = finalizeEvent(template, hexToBytes(link.signerSk));
      this.eventStore.add(signed);
      this.pool.publish(inviteRelays, signed).catch((err) => console.warn("invite bundle refresh publish failed", err));
    }
  }

  async revokeInvite(invite: ConcordInviteLink): Promise<ConcordInviteLink> {
    const template = await InviteBundleFactory.revoke();
    const signed = finalizeEvent(template, hexToBytes(invite.signerSk));
    this.eventStore.add(signed);
    await this.pool
      .publish(this.relays(), signed)
      .catch((err) => console.warn("bundle revocation publish failed", err));
    await this.admin.unregisterInviteLink(invite.signerPubkey);

    const revoked = { ...invite, revoked: true };
    await this.onInviteRevoked?.(revoked);
    return revoked;
  }

  /**
   * Grant a member access to one or more private channels we hold (CORD-05 §6 /
   * CORD-03: "delivered on grant"). Hands over each channel's CURRENT `(key, epoch)`
   * — plus any held prior keys, so they read recent history — via a single Direct
   * Invite gift-wrapped to `member`. This is the spec-correct way to ADD someone: no
   * rotation and no epoch bump (rotations sever, and a {@link rotateChannel} can
   * never onboard a new holder — its continuity check requires the prior key).
   * The bundle carries only the requested channel keys (never the caller's other
   * private channels), so an inviter can hand-pick an arbitrary subset. Requires
   * `MANAGE_CHANNELS`. Publish is best-effort to the community relays, where the
   * recipient's Direct-Invite watcher also listens.
   */
  async grantChannelAccess(channels: string | string[], member: string): Promise<void> {
    const ids = [...new Set(Array.isArray(channels) ? channels : [channels])];
    if (ids.length === 0) throw new Error("no channels to grant");
    if (!this.canDo(PERM.MANAGE_CHANNELS)) throw new Error("need MANAGE_CHANNELS to grant channel access");

    const state = this.state$.value;
    const bundle: InviteBundle = buildInviteBundle(this.material, {
      name: state.metadata?.name,
      icon: state.metadata?.icon,
      creator_npub: this.pubkey,
      channels: ids,
    });

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

  // ---- permissions --------------------------------------------------------
  //
  // Snapshot and reactive forms of the same checks. The snapshot form is correct in
  // an event handler (an answer at click-time) and is what the engine's own guards
  // use; a render path wants the `$` form, because a role grant that changes the
  // answer has to re-render the button it gates.

  /** A member's resolved authority — snapshot. */
  standingOf(member: string): Standing {
    return this.admin.standingOf(member);
  }

  /** A member's resolved authority, re-emitted whenever roles or grants move. */
  standing$(member: string): Observable<Standing> {
    return this.state$.pipe(
      map(() => this.standingOf(member)),
      distinctUntilChanged(sameStanding),
    );
  }

  /** Whether the logged-in user holds `perm` (and outranks `targetPosition`) — snapshot. */
  canDo(perm: bigint, targetPosition = 0xffffffff): boolean {
    return this.admin.canDo(perm, targetPosition);
  }

  /** Reactive {@link canDo} — prefer this in a render path. */
  can$(perm: bigint, targetPosition = 0xffffffff): Observable<boolean> {
    return this.state$.pipe(
      map(() => this.canDo(perm, targetPosition)),
      distinctUntilChanged(),
    );
  }

  /**
   * Whether the logged-in user may act on `member` with `perm` — reactive. Holding
   * the bit isn't enough: CORD-04 requires strictly outranking the target, and you
   * can never act on yourself (you never outrank yourself). Both halves are folded
   * in here so a caller can't pair `canDo` with a stale `standingOf` position or
   * forget the self-check.
   */
  canModerate$(member: string, perm: bigint): Observable<boolean> {
    return this.state$.pipe(
      map(() => member !== this.pubkey && this.canDo(perm, this.standingOf(member).position)),
      distinctUntilChanged(),
    );
  }
}
