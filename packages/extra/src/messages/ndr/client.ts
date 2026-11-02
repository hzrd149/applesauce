import {
  AppKeys,
  createPersistentNostrOutbox,
  GROUP_ROSTER_FACT_KIND,
  Invite,
  isAppKeysEvent,
  isGroupAdmin,
  isGroupRosterFactEvent,
  NdrRuntime,
  parseGroupRosterFactRumor,
  type GroupDecryptedEvent,
  type NdrRuntimeState,
  type OnEventMeta,
  type PreparedRegistration,
  type Rumor,
  type StorageAdapter,
} from "nostr-double-ratchet";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  EMPTY,
  map,
  Observable,
  shareReplay,
  Subject,
  switchMap,
  type MonoTypeOperatorFunction,
} from "rxjs";
import type { FileMetadataFields } from "applesauce-common/helpers/file-metadata";
import { uploadEncryptedFile, type UploadEncryptedFileOptions } from "../common/attachments.js";
import type { MessageStorage } from "../common/types.js";
import { NdrConversation } from "./conversation.js";
import { NdrGroupConversation } from "./group.js";
import { getNdrGroupConversationId, NdrHistory } from "./history.js";
import { createStoredNdrMessage, isNdrChatRumor } from "./message.js";
import { createNdrTransport, type NdrTransport } from "./transport.js";
import type {
  NdrClientError,
  NdrClientLifecycle,
  NdrConversationSummary,
  NdrDevice,
  NdrGroupRecord,
  NdrMessagesClientOptions,
} from "./types.js";

const CHAT_KIND = 14;
const REACTION_KIND = 7;
const RECEIPT_KIND = 15;
const TYPING_KIND = 25;
const CHAT_SETTINGS_KIND = 10448;
const APP_KEYS_KIND = 37368;
const OUTBOX_PREFIX = "v1/runtime-outbox/";
const TYPING_TIMEOUT = 6000;
const EXPIRY_INTERVAL = 60_000;

/** Shutdowns per lock, so a replacement client waits for its predecessor to release storage */
const shutdowns = new Map<string, Promise<void>>();

/** Thrown when another tab or client holds the account's storage lock */
class NdrLockedError extends Error {
  constructor() {
    super("NDR for this account is open in another tab");
  }
}

function getTag(rumor: Pick<Rumor, "tags">, name: string): string | undefined {
  return rumor.tags.find((tag) => tag[0] === name)?.[1];
}

/**
 * Checks that an event is a well-formed AppKeys roster from one of the followed peers
 * @note kind 37368 is shared with group roster facts and other applications, so relays return events the runtime would reject
 */
function isValidPeerRoster(event: Parameters<typeof AppKeys.fromEvent>[0], peers: string[]): boolean {
  if (!peers.includes(event.pubkey) || !isAppKeysEvent(event)) return false;

  try {
    AppKeys.fromEvent(event);
    return true;
  } catch {
    return false;
  }
}

function shareLatest<T>(): MonoTypeOperatorFunction<T> {
  return shareReplay({ bufferSize: 1, refCount: true });
}

/** Wraps storage so writes stop at disposal, teardown can wait for in-flight writes, and changes can be observed */
function guardStorage(
  storage: StorageAdapter,
  signal: AbortSignal,
  writes: Set<Promise<unknown>>,
  onWrite: (key: string) => void,
): StorageAdapter {
  async function track<T>(key: string, operation: () => Promise<T>) {
    signal.throwIfAborted();
    const pending = operation();
    writes.add(pending);
    try {
      const result = await pending;
      onWrite(key);
      return result;
    } finally {
      writes.delete(pending);
    }
  }

  return {
    get: async (key) => {
      signal.throwIfAborted();
      return storage.get(key);
    },
    put: (key, value) => track(key, () => storage.put(key, value)),
    del: (key) => track(key, () => storage.del(key)),
    list: async (prefix) => {
      signal.throwIfAborted();
      return storage.list(prefix);
    },
  };
}

/** A double-ratchet messages client that owns one account's NDR runtime, outbox, history, and device keys */
export class NdrMessagesClient {
  /** The account's owner pubkey */
  readonly pubkey: string;
  /** The account signer, absent on a device linked by another device */
  readonly signer: NdrMessagesClientOptions["signer"];
  /** The explicit NDR discovery and delivery relays */
  readonly relays: string[];
  /** The underlying runtime for protocol features this client does not wrap */
  readonly runtime: NdrRuntime;
  /** The transport hooks connecting the runtime to the shared pool and store */
  readonly transport: NdrTransport;
  /** The decrypted message history */
  readonly history: NdrHistory;

  private readonly options: NdrMessagesClientOptions;
  private readonly storage: StorageAdapter;
  private readonly outbox: ReturnType<typeof createPersistentNostrOutbox>;
  private readonly lifetime = new AbortController();
  private readonly writes = new Set<Promise<unknown>>();
  private readonly detach: (() => void)[] = [];
  private readonly publishedIds = new Set<string>();
  private readonly conversationCache = new Map<string, NdrConversation>();
  private readonly groupCache = new Map<string, NdrGroupConversation>();
  private starting?: Promise<void>;
  private invitePublished = false;
  private stop!: () => void;
  private readonly stopped = new Promise<void>((resolve) => (this.stop = resolve));

  private readonly lifecycle = new BehaviorSubject<NdrClientLifecycle>("idle");
  /** The client's lifecycle */
  readonly lifecycle$ = this.lifecycle.asObservable();

  private readonly state: BehaviorSubject<NdrRuntimeState>;
  /** The runtime's registration and readiness state */
  readonly state$: Observable<NdrRuntimeState>;

  private readonly errors = new Subject<NdrClientError>();
  /** Background failures that do not stop the client */
  readonly errors$ = this.errors.asObservable();

  private readonly pending = new BehaviorSubject(0);
  /** The number of signed envelopes waiting in the persistent outbox */
  readonly pendingPublications$ = this.pending.asObservable();

  private readonly typing = new BehaviorSubject<ReadonlyMap<string, number>>(new Map());
  /** Typing deadlines in milliseconds by conversation ID */
  readonly typingDeadlines$ = this.typing.asObservable();

  /** The owner's registered devices with local labels */
  readonly devices$: Observable<NdrDevice[]>;
  /** Direct and group conversations, newest activity first */
  readonly conversations$: Observable<NdrConversationSummary[]>;
  /** Stored groups, including pending invitations */
  readonly groups$: Observable<NdrGroupRecord[]>;

  /**
   * Creates a client without starting the runtime
   * @throws if relays are empty or deadlines are invalid
   */
  constructor(options: NdrMessagesClientOptions) {
    this.options = options;
    this.pubkey = options.pubkey;
    this.signer = options.signer;
    // The outbox count follows its storage rows, which are removed only after onPublished resolves.
    this.storage = guardStorage(options.storage, this.lifetime.signal, this.writes, (key) => {
      if (key.startsWith(OUTBOX_PREFIX)) void this.refreshPending();
    });
    this.history = new NdrHistory(this.storage);

    this.transport = createNdrTransport(
      { eventStore: options.eventStore, pool: options.pool },
      {
        ownerPubkey: options.pubkey,
        signer: options.signer,
        relays: options.relays,
        fetchTimeoutMs: options.fetchTimeoutMs,
        actionTimeoutMs: options.actionTimeoutMs,
        onSubscriptionError: (error) => this.report("subscribe", error),
      },
    );
    this.relays = options.relays;

    this.outbox = createPersistentNostrOutbox({
      storage: this.storage,
      publish: this.transport.nostrPublish,
      onError: ({ error }) => this.report("publish", error),
      onPublished: async ({ innerEventId }) => {
        if (innerEventId) await this.markPublished(innerEventId);
      },
    });

    this.runtime = new NdrRuntime({
      ...this.transport,
      storage: this.storage,
      nostrEnqueue: this.outbox.enqueue,
      nostrPublish: this.outbox.publish,
      onPublishError: ({ error }) => this.report("publish", error),
      appKeysFetchTimeoutMs: options.appKeysTimeoutMs,
      appKeysFastTimeoutMs: options.appKeysTimeoutMs && Math.min(options.appKeysTimeoutMs, 2000),
    });

    this.state = new BehaviorSubject(this.runtime.getState());
    this.state$ = this.state.asObservable();

    this.devices$ = combineLatest([this.state, this.history.changes$]).pipe(
      map(([state]) =>
        state.registeredDevices
          .map((device) => ({
            identityPubkey: device.identityPubkey,
            createdAt: device.createdAt,
            current: device.identityPubkey === state.currentDevicePubkey,
            label: this.history.label(device.identityPubkey),
          }))
          .sort((a, b) => a.createdAt - b.createdAt),
      ),
      shareLatest(),
    );

    this.conversations$ = this.history.changes$.pipe(
      map(() => this.history.conversations()),
      shareLatest(),
    );

    this.groups$ = this.history.changes$.pipe(
      map(() => this.history.groups()),
      shareLatest(),
    );
  }

  /** Whether the client has been disposed */
  get isDisposed(): boolean {
    return this.lifetime.signal.aborted;
  }

  private get lockName() {
    return this.options.lockName ?? `ndr:${this.pubkey}`;
  }

  private assertActive() {
    if (this.isDisposed) throw new Error("NDR client disposed");
  }

  /** Reports a background failure unless the client is disposed */
  report(operation: NdrClientError["operation"], error: unknown): void {
    if (this.isDisposed) return;
    this.errors.next({ operation, error });
  }

  /** A storage adapter for one conversation's drafts, outside the history mirror */
  draftStorage(): MessageStorage {
    return {
      getItem: async (key) => (await this.storage.get<string>(`app-drafts/${key}`)) ?? null,
      setItem: (key, value) => this.storage.put(`app-drafts/${key}`, value),
      removeItem: (key) => this.storage.del(`app-drafts/${key}`),
    };
  }

  private async refreshPending() {
    try {
      const keys = await this.storage.list(OUTBOX_PREFIX);
      if (!this.isDisposed) this.pending.next(keys.length);
    } catch {
      // Disposal rejects storage reads; the count is irrelevant afterwards.
    }
  }

  private async markPublished(innerEventId: string) {
    this.publishedIds.add(innerEventId);
    if (this.publishedIds.size > 500) this.publishedIds.delete(this.publishedIds.values().next().value!);
    await this.history.advanceDelivery(innerEventId, "published");
  }

  /** Stores a message this device sent, applying a relay acceptance that may have arrived first */
  async storeSent(conversationId: string, rumor: Rumor): Promise<void> {
    await this.history.addMessage(
      createStoredNdrMessage(rumor, {
        conversationId,
        sender: this.pubkey,
        senderDevice: this.state.value.currentDevicePubkey ?? undefined,
        delivery: this.publishedIds.has(rumor.id) ? "published" : "queued",
      }),
    );
  }

  /**
   * Encrypts a file and uploads the ciphertext, returning the attachment to send with a message
   * @throws if no uploader is configured or the upload fails
   */
  async uploadFile(file: Blob, options: UploadEncryptedFileOptions = {}): Promise<FileMetadataFields> {
    if (!this.options.upload) throw new Error("No file uploader configured");
    return uploadEncryptedFile(file, this.options.upload, options);
  }

  private withLock(work: () => Promise<void>): Promise<void> {
    const locks = globalThis.navigator?.locks;
    if (this.lockName === false || !locks) return work();

    return locks.request(this.lockName, { ifAvailable: true }, async (lock) => {
      if (!lock) throw new NdrLockedError();
      await work();
    });
  }

  /**
   * Restores history, takes the account lock, and initializes the runtime; resolves once ready
   * @throws if another tab holds the lock, the client is disposed, or initialization fails
   */
  start(): Promise<void> {
    this.starting ??= new Promise<void>((resolve, reject) => {
      void this.run(resolve, reject);
    });
    return this.starting;
  }

  private async run(onReady: () => void, onFail: (error: unknown) => void) {
    // Without a lock the caller owns storage isolation, so there is no predecessor to wait for.
    const lockKey = this.lockName || undefined;
    const previous = lockKey ? shutdowns.get(lockKey) : undefined;
    let release!: () => void;
    const shutdown = new Promise<void>((resolve) => (release = resolve));
    if (lockKey) shutdowns.set(lockKey, shutdown);

    try {
      await previous;
      this.assertActive();
      this.lifecycle.next("starting");

      await this.withLock(async () => {
        await this.history.restore();
        this.assertActive();

        // Consumers attach before init so durable replay cannot advance the ratchet past unsaved messages.
        this.attachConsumers();
        await this.runtime.initForOwner(this.pubkey);
        this.assertActive();

        const groups = this.history.groups().filter((record) => !record.removed);
        await this.runtime.syncGroups(groups.map((record) => record.data));
        this.assertActive();

        this.startBackgroundWork();
        this.lifecycle.next("ready");
        onReady();

        // Hold the lock until disposal so only one runtime writes this account's ratchet state.
        await this.stopped;
      });
    } catch (error) {
      if (!this.isDisposed) {
        this.lifecycle.next(error instanceof NdrLockedError ? "locked" : "error");
        this.report("start", error);
      }
      onFail(error);
    } finally {
      this.teardown();
      await this.outbox.close().catch(() => {});
      await Promise.allSettled([...this.writes]);
      release();
      if (lockKey && shutdowns.get(lockKey) === shutdown) shutdowns.delete(lockKey);
    }
  }

  private attachConsumers() {
    this.detach.push(
      this.runtime.onStateChange((state) => {
        if (this.isDisposed) return;
        this.state.next(state);

        // A newly registered or linked device announces its own invite; this is device-signed and never prompts.
        if (state.isCurrentDeviceRegistered && state.sessionManagerReady && !this.invitePublished) {
          this.invitePublished = true;
          this.runtime.republishInvite().catch((error) => {
            this.invitePublished = false;
            this.report("publish", error);
          });
        }
      }),
    );

    this.detach.push(
      this.runtime.onDurableSessionEvent(
        [CHAT_KIND, REACTION_KIND, RECEIPT_KIND, CHAT_SETTINGS_KIND],
        (rumor, from, meta) => this.receiveDirect(rumor, from, meta),
      ),
    );

    this.detach.push(
      this.runtime.onSessionEvent((rumor, from, meta) => {
        const sender = meta?.senderOwnerPubkey ?? from;
        if (rumor.kind !== TYPING_KIND || sender === this.pubkey) return;
        this.setTyping(sender, Date.now() + TYPING_TIMEOUT);
      }),
    );

    this.detach.push(this.runtime.onGroupEvent((event) => this.receiveGroup(event)));
  }

  private startBackgroundWork() {
    const retry = () => {
      this.outbox.retry().catch((error) => this.report("publish", error));
    };
    retry();
    void this.refreshPending();

    const purge = setInterval(() => {
      this.history.purgeExpired().catch((error) => this.report("storage", error));
    }, EXPIRY_INTERVAL);

    const rosters = this.followPeerAppKeys();

    globalThis.addEventListener?.("online", retry);
    this.detach.push(() => {
      clearInterval(purge);
      rosters.unsubscribe();
      globalThis.removeEventListener?.("online", retry);
    });
  }

  /** Returns the owners this account messages directly or through groups */
  private knownPeers(): string[] {
    const peers = new Set<string>();
    for (const summary of this.history.conversations()) {
      if (summary.type === "direct") peers.add(summary.id);
    }
    for (const record of this.history.groups()) {
      for (const member of record.data.members) peers.add(member);
    }

    peers.delete(this.pubkey);
    return [...peers].sort();
  }

  /**
   * Applies every peer roster update to the runtime so newly linked peer devices receive messages
   * @note the runtime only follows rosters of peers whose sessions it initiated, so peers that opened a session would otherwise keep a stale device list
   */
  private followPeerAppKeys() {
    return this.history.changes$
      .pipe(
        map(() => this.knownPeers()),
        distinctUntilChanged((a, b) => a.join() === b.join()),
        switchMap((peers) => {
          if (!peers.length) return EMPTY;

          return new Observable<Parameters<NdrRuntime["applyVerifiedAppKeysEvent"]>[0]>((subscriber) =>
            this.transport.nostrSubscribe({ kinds: [APP_KEYS_KIND], authors: peers }, (event) => {
              if (isValidPeerRoster(event, peers)) subscriber.next(event);
            }),
          );
        }),
      )
      .subscribe((event) => {
        // The runtime ignores stale rosters, so replayed events are harmless.
        this.runtime.applyVerifiedAppKeysEvent(event).catch((error) => this.report("subscribe", error));
      });
  }

  private setTyping(conversationId: string, deadline: number | undefined) {
    const next = new Map(this.typing.value);
    if (deadline) next.set(conversationId, deadline);
    else next.delete(conversationId);
    this.typing.next(next);
  }

  /** Resolves the peer of a direct rumor, using its `p` tag when this owner sent it from another device */
  private directPeer(rumor: Rumor, sender: string): string | undefined {
    if (sender !== this.pubkey) return sender;
    return rumor.tags.find((tag) => tag[0] === "p" && tag[1] !== this.pubkey)?.[1];
  }

  private async receiveDirect(rumor: Rumor, from: string, meta?: OnEventMeta) {
    this.assertActive();
    const sender = meta?.senderOwnerPubkey ?? from;

    // Pairwise group traffic carries a group label and belongs to the group history.
    const groupId = getTag(rumor, "l");
    if (groupId) {
      if (this.history.group(groupId)) await this.storeGroupRumor(groupId, rumor, sender, meta?.senderDevicePubkey);
      return;
    }

    const peer = this.directPeer(rumor, sender);
    if (!peer) return;

    // Chat messages include NIP-17 kind 15 file messages, which share their kind with receipts.
    if (isNdrChatRumor(rumor)) {
      const incoming = sender !== this.pubkey;
      const added = await this.history.addMessage(
        createStoredNdrMessage(rumor, {
          conversationId: peer,
          sender,
          senderDevice: meta?.senderDevicePubkey,
          // A copy from another of this owner's devices already crossed a relay.
          delivery: incoming ? "received" : "published",
        }),
      );

      if (incoming) this.setTyping(peer, undefined);
      if (added && incoming && this.options.deliveredReceipts !== false) {
        this.runtime.sendReceipt(peer, "delivered", [rumor.id]).catch((error) => this.report("receipt", error));
      }
      return;
    }

    switch (rumor.kind) {
      case REACTION_KIND: {
        const target = getTag(rumor, "e");
        if (target) await this.history.addReaction(peer, { id: rumor.id, target, content: rumor.content, sender });
        break;
      }

      case RECEIPT_KIND: {
        const ids = rumor.tags.filter((tag) => tag[0] === "e").map((tag) => tag[1]);
        if (rumor.content !== "delivered" && rumor.content !== "seen") break;

        if (sender === this.pubkey) {
          // Another device of this owner saw the peer's messages.
          if (rumor.content === "seen") await this.history.markRead(peer, rumor.created_at);
        } else {
          await this.history.addReceipt(peer, ids, rumor.content);
        }
        break;
      }

      case CHAT_SETTINGS_KIND: {
        try {
          const settings = JSON.parse(rumor.content) as { messageTtlSeconds?: number | null };
          await this.history.setTtl(peer, settings.messageTtlSeconds || null);
        } catch (error) {
          this.report("receive", error);
        }
        break;
      }
    }
  }

  private async storeGroupRumor(groupId: string, rumor: Rumor, sender: string, senderDevice?: string) {
    const conversationId = getNdrGroupConversationId(groupId);

    if (isNdrChatRumor(rumor)) {
      await this.history.addMessage(
        createStoredNdrMessage(rumor, {
          conversationId,
          sender,
          senderDevice,
          delivery: sender === this.pubkey ? "published" : "received",
        }),
      );
    } else if (rumor.kind === REACTION_KIND) {
      const target = getTag(rumor, "e");
      if (target)
        await this.history.addReaction(conversationId, { id: rumor.id, target, content: rumor.content, sender });
    }
  }

  private async receiveGroup(event: GroupDecryptedEvent) {
    this.assertActive();
    const sender = event.senderOwnerPubkey ?? event.senderDevicePubkey;

    if (event.inner.kind === GROUP_ROSTER_FACT_KIND && isGroupRosterFactEvent(event.inner)) {
      await this.applyRoster(event.groupId, event.inner);
      return;
    }

    await this.storeGroupRumor(event.groupId, event.inner, sender, event.senderDevicePubkey);
  }

  private async applyRoster(groupId: string, rumor: Rumor) {
    let fact: ReturnType<typeof parseGroupRosterFactRumor>;
    try {
      fact = parseGroupRosterFactRumor(rumor);
    } catch (error) {
      // A malformed roster must not block the durable handler, which would replay it forever.
      this.report("receive", error);
      return;
    }
    const existing = this.history.group(groupId);
    // The group manager has already validated the admin and applied the roster.
    const data = this.runtime.getGroupManager()?.getGroup(groupId);

    if (!data) {
      if (existing) await this.history.putGroup({ ...existing, revision: fact.revision, removed: true });
      return;
    }

    await this.history.putGroup({
      // Another device of an admin receives its own group as a roster fact, which is not an invitation.
      data: { ...data, accepted: existing?.data.accepted ?? (isGroupAdmin(data, this.pubkey) || data.accepted) },
      revision: Math.max(fact.revision, existing?.revision ?? 0),
      createdBy: existing?.createdBy ?? fact.createdBy,
    });
  }

  /** Returns the direct conversation with a peer */
  conversation(peer: string): NdrConversation {
    this.assertActive();
    let conversation = this.conversationCache.get(peer);
    if (!conversation) {
      conversation = new NdrConversation(this, peer);
      this.conversationCache.set(peer, conversation);
    }
    return conversation;
  }

  /** Returns a stored group's conversation */
  group(groupId: string): NdrGroupConversation {
    this.assertActive();
    let group = this.groupCache.get(groupId);
    if (!group) {
      group = new NdrGroupConversation(this, groupId);
      this.groupCache.set(groupId, group);
    }
    return group;
  }

  /**
   * Creates a group, sends its roster to the members, and stores it
   * @throws if the client is not ready or the runtime fails
   */
  async createGroup(name: string, members: string[]): Promise<NdrGroupConversation> {
    this.assertActive();
    const others = [...new Set(members)].filter((member) => member !== this.pubkey);
    const result = await this.runtime.createGroup(name, others);

    await this.history.putGroup({ data: { ...result.group, accepted: true }, revision: 1, createdBy: this.pubkey });
    return this.group(result.group.id);
  }

  /**
   * Prepares this device's app-key registration so the new roster can be reviewed before signing
   * @throws if there is no signer or the current roster cannot be resolved
   */
  async prepareRegistration(deviceLabel?: string): Promise<PreparedRegistration> {
    this.assertActive();
    if (!this.signer) throw new Error("Registering a device requires the account signer");
    return this.runtime.prepareRegistration({ ownerPubkey: this.pubkey, deviceLabel });
  }

  /**
   * Signs and publishes a prepared registration, then publishes this device's invite
   * @throws if signing fails or relays do not confirm the roster
   */
  async publishRegistration(prepared: PreparedRegistration, deviceLabel?: string): Promise<void> {
    this.assertActive();
    await this.runtime.publishPreparedRegistration(prepared);
    if (deviceLabel) await this.history.setLabel(prepared.newDeviceIdentity, deviceLabel);

    await this.runtime.republishInvite();
    this.invitePublished = true;
  }

  /**
   * Removes a device from the owner's app keys
   * @throws if there is no signer or publication fails
   */
  async revokeDevice(identityPubkey: string): Promise<void> {
    this.assertActive();
    if (!this.signer) throw new Error("Revoking a device requires the account signer");
    await this.runtime.revokeDevice({ ownerPubkey: this.pubkey, identityPubkey });
  }

  /**
   * Sets or clears a device's local label
   * @throws if storage fails
   */
  setDeviceLabel(identityPubkey: string, label: string | undefined): Promise<void> {
    return this.history.setLabel(identityPubkey, label?.trim() || undefined);
  }

  /**
   * Publishes this device's invite again
   * @throws if publication fails
   */
  async republishInvite(): Promise<void> {
    this.assertActive();
    await this.runtime.republishInvite();
  }

  /**
   * Replaces this device's invite so new sessions use fresh invite keys
   * @throws if publication fails
   */
  async rotateInvite(): Promise<void> {
    this.assertActive();
    await this.runtime.rotateInvite();
  }

  /**
   * Returns a link URL for another device of this owner to approve
   * @param root the URL prefix for the encoded invite
   */
  async createLinkInvite(root?: string): Promise<string> {
    this.assertActive();
    const invite = await this.runtime.createLinkInvite(this.pubkey);
    return invite.getUrl(root);
  }

  /**
   * Approves a link URL from a new device, opening a session and adding it to the app keys
   * @throws if the URL is not a link invite for this owner, or signing or publication fails
   */
  async approveLink(url: string, deviceLabel?: string): Promise<string> {
    this.assertActive();
    if (!this.signer) throw new Error("Approving a device requires the account signer");

    const invite = Invite.fromUrl(url);
    if (invite.purpose !== "link") throw new Error("Not a device link invite");
    if (invite.ownerPubkey && invite.ownerPubkey !== this.pubkey) throw new Error("Link invite is for another account");

    await this.runtime.acceptLinkInvite(invite, this.pubkey);
    await this.runtime.registerDeviceIdentity({
      ownerPubkey: this.pubkey,
      identityPubkey: invite.inviter,
      deviceLabel,
    });
    if (deviceLabel) await this.history.setLabel(invite.inviter, deviceLabel);

    return invite.inviter;
  }

  /**
   * Retries publishing every envelope in the persistent outbox
   * @throws if the outbox is closed
   */
  async retryPublications(): Promise<void> {
    await this.outbox.retry();
    await this.refreshPending();
  }

  private teardown() {
    if (!this.lifetime.signal.aborted) this.lifetime.abort();
    this.stop();

    for (const detach of this.detach.splice(0)) detach();
    for (const conversation of this.conversationCache.values()) conversation.dispose();
    for (const group of this.groupCache.values()) group.dispose();
    this.conversationCache.clear();
    this.groupCache.clear();

    this.runtime.close();
    this.transport.dispose();
  }

  /** Stops the runtime, releases the account lock after pending writes, and keeps all stored state */
  dispose(): void {
    if (this.lifecycle.value === "disposed") return;
    const started = !!this.starting;

    this.teardown();
    this.lifecycle.next("disposed");
    this.errors.complete();

    // An unstarted client has no run loop to close the outbox.
    if (!started) void this.outbox.close().catch(() => {});
  }
}
