import {
  createConversationIdentifier,
  getConversationIdentifierFromMessage,
  getConversationParticipants,
  isGiftWrapUnlocked,
  isWrappedMessage,
} from "applesauce-common/helpers";
import type { FileMetadataFields } from "applesauce-common/helpers/file-metadata";
import { kinds, unixNow, type Filter, type NostrEvent, type Rumor } from "applesauce-core/helpers";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  EMPTY,
  firstValueFrom,
  fromEvent,
  lastValueFrom,
  map,
  Observable,
  of,
  ReplaySubject,
  Subject,
  Subscription,
  takeUntil,
  timeout,
} from "rxjs";
import { MessageAuthentication, type MessageAuthenticationResult } from "../common/authentication.js";
import { uploadEncryptedFile, type UploadEncryptedFileOptions } from "../common/attachments.js";
import type { MessageClientError, MessageOperationOptions, MessagesRelayStatus } from "../common/types.js";
import type {
  WrappedMessageAvailability,
  WrappedMessageHistoryOptions,
  WrappedMessageSendRequest,
  WrappedMessagesClientOptions,
  WrappedMessagesSyncStatus,
  PreparedWrappedMessage,
  WrappedConversationSummary,
  WrappedConversationListOptions,
  WrappedConversationIndexingOptions,
  WrappedConversationIndexEntry,
  WrappedConversationIndexStore,
} from "./types.js";
import { WrappedMessageSession } from "./session.js";
import { WrappedConversation } from "./conversation.js";
import { MemoryWrappedConversationIndexStore } from "./conversation-index.js";
import { ConversationDraftState } from "../common/drafts.js";
import { GiftWrapReceiver } from "../../gift-wrap/receiver.js";

const TWO_DAYS = 2 * 24 * 60 * 60;

/** The number of rumors read from the rumor store per filter while indexing conversations */
const INDEXING_PAGE_SIZE = 500;

/** Checks whether a rumor is newer than a conversation's indexed message, breaking timestamp ties by the lower id */
function isNewerThan(rumor: Rumor, entry: WrappedConversationIndexEntry | undefined): boolean {
  if (!entry) return true;
  if (rumor.created_at !== entry.lastActivity) return rumor.created_at > entry.lastActivity;

  return rumor.id < entry.lastMessageId;
}

/** An account-scoped NIP-17 inbox with per-recipient gift wraps and resumable publication */
export class WrappedMessagesClient {
  /** The immutable owner pubkey */
  readonly pubkey: string;

  /** The shared event store containing encrypted envelopes */
  readonly eventStore;

  /** The shared relay pool */
  readonly pool;

  /** The account signer */
  readonly signer;

  /** The incoming receiver, owned by this client only when constructed internally */
  readonly receiver: GiftWrapReceiver;
  /** The shared validated plaintext store used by the receiver and conversation queries */
  readonly rumorStore;
  private readonly ownsReceiver: boolean;
  private readonly subscriptions = new Subscription();

  /** NIP-01 filters for this account's chat and file rumors in the shared rumor store */
  readonly messageFilters: Filter[];

  private readonly conversationIndex: WrappedConversationIndexStore;
  private readonly conversationUpdates = new Subject<WrappedConversationSummary>();

  /** The conversations whose newest message changed, for updating pages loaded with conversations() */
  readonly conversationUpdates$ = this.conversationUpdates.asObservable();

  // Serializes index writes so live arrivals and indexConversations() never overwrite each other
  private conversationWrites: Promise<unknown> = Promise.resolve();

  /** The owner's read relays */
  readonly relays$: Observable<string[]>;

  /** The inbox relay connection states */
  readonly relayStatus$: Observable<MessagesRelayStatus[]>;

  /** The owner's encrypted gift wraps */
  readonly giftWraps$: Observable<NostrEvent[]>;

  /** The pending, unlocked and failed decryption counts */
  readonly decryptionState$;

  private readonly lifecycle = new BehaviorSubject<"idle" | "loading" | "ready" | "disposed">("idle");

  /** The background loading lifecycle, independent of decryption */
  readonly status$ = this.lifecycle.asObservable();

  private readonly errors = new Subject<MessageClientError>();

  /** Nonterminal failures from individual operations */
  readonly errors$ = this.errors.asObservable();

  private readonly destroyed = new ReplaySubject<void>(1);
  private readonly syncState = new BehaviorSubject<WrappedMessagesSyncStatus | undefined>(undefined);

  /** The latest background history reconciliation progress */
  readonly syncStatus$ = this.syncState.asObservable();

  private readonly sending = new BehaviorSubject(0);

  /** Whether one or more send operations are in progress */
  readonly busy$ = this.sending.pipe(map((count) => count > 0));

  private readonly publications = new BehaviorSubject<
    Record<string, "prepared" | "publishing" | "accepted" | "failed">
  >({});

  /** The publication states of messages sent during this client lifetime */
  readonly publications$ = this.publications.asObservable();

  private readonly session: WrappedMessageSession;
  private readonly authentication: MessageAuthentication;

  /** The pending relay authentication requests */
  readonly authRequests$;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;
  private readonly conversationInstances = new Map<
    string,
    { conversation: WrappedConversation; drafts: ConversationDraftState }
  >();

  /**
   * Creates a stopped wrapped client using shared application dependencies
   * @throws if an injected receiver does not match the account, store, or pool, or receiver configuration is invalid
   */
  constructor(private readonly options: WrappedMessagesClientOptions) {
    if (options.receiver && options.receiverOptions)
      throw new Error("Receiver and receiverOptions are mutually exclusive");
    if (
      options.receiver &&
      (options.receiver.pubkey !== options.pubkey ||
        options.receiver.eventStore !== options.eventStore ||
        options.receiver.pool !== options.pool)
    )
      throw new Error("Receiver must match the client account, event store, and relay pool");
    if (options.receiver && options.rumorStore && options.receiver.rumorStore !== options.rumorStore)
      throw new Error("Receiver must use the client rumor store");

    this.ownsReceiver = !options.receiver;
    this.receiver =
      options.receiver ??
      new GiftWrapReceiver({
        signer: options.signer,
        cacheRequest: options.cacheRequest,
        decryptionCache: options.decryptionCache,
        autoUnlock: options.autoUnlock,
        fallbackRelays: options.fallbackRelays,
        timeout: options.timeout ?? 4000,
        decryptionTimeout: options.decryptionTimeout,
        historySpan: (options.historySpan ?? 30 * 86400) + TWO_DAYS,
        authTimeout: options.authTimeout,
        onAuthRequired: options.onAuthRequired,
        ...options.receiverOptions,
        pubkey: options.pubkey,
        eventStore: options.eventStore,
        pool: options.pool,
        rumorStore: options.rumorStore,
      });
    this.rumorStore = this.receiver.rumorStore;
    this.authentication = new MessageAuthentication(options.pool, options.pubkey, options.signer);
    this.authRequests$ = combineLatest([this.authentication.requests$, this.receiver.authRequests$]).pipe(
      map(([sending, receiving]) => [
        ...new Map([...sending, ...receiving].map((request) => [request.url, request])).values(),
      ]),
      takeUntil(this.destroyed),
    );
    options = this.options = { ...options, ...this.authentication.configure(options) };
    this.pubkey = options.pubkey;
    this.eventStore = options.eventStore;
    this.pool = options.pool;
    this.signer = options.signer;
    this.messageFilters = [
      { kinds: [kinds.PrivateDirectMessage, kinds.FileMessage], authors: [this.pubkey] },
      { kinds: [kinds.PrivateDirectMessage, kinds.FileMessage], "#p": [this.pubkey] },
    ];

    const signer = options.signer ?? {
      getPublicKey: async () => options.pubkey,
      signEvent: async () => {
        throw new Error("A signer is required");
      },
    };
    const owner = { pubkey: this.pubkey, signer };
    this.session = new WrappedMessageSession(options, owner, async (event, signal) => {
      try {
        await this.receiver.unlock(event, { signal });
      } catch {
        // Receiver errors remain observable independently of accepted publication.
        signal.throwIfAborted();
      }
    });

    this.relays$ = this.receiver.relays$;
    this.giftWraps$ = this.receiver.giftWraps$;
    this.relayStatus$ = combineLatest([this.relays$, this.pool.status$ ?? of({})]).pipe(
      map(([relays, connections]) => relays.map((url) => ({ url, connection: connections[url] }))),
    );

    this.subscriptions.add(
      this.receiver.errors$.subscribe(({ operation, error, eventId }) => {
        const clientOperation = operation === "cache" ? "restore" : operation === "persistence" ? "storage" : operation;
        this.report(clientOperation, error, eventId);
      }),
    );

    this.conversationIndex = options.conversationIndex ?? new MemoryWrappedConversationIndexStore();

    // Index failures are reported without stopping the subscription, so the next message is still recorded.
    this.subscriptions.add(
      this.rumorStore
        .filters(this.messageFilters, true)
        .pipe(
          concatMap((rumor) =>
            defer(() => this.recordConversation(rumor)).pipe(
              catchError((error) => {
                this.report("storage", error, rumor.id);
                return EMPTY;
              }),
            ),
          ),
        )
        .subscribe(),
    );

    // Derive counts from envelopes; rumor models expose only successfully decrypted messages.
    this.decryptionState$ = combineLatest([this.giftWraps$, this.receiver.decryptionState$]).pipe(
      map(([events, state]) => ({
        total: state.total,
        unlocked: state.unlocked,
        locked: events.filter((event) => !isGiftWrapUnlocked(event) && !state.errors.has(event.id)).length,
        failed: [...state.errors.keys()],
        pending: state.pending,
      })),
    );
  }

  /** Records a message as its conversation's newest activity when it is newer than the indexed message */
  private recordConversation(rumor: Rumor): Promise<void> {
    if (!isWrappedMessage(rumor)) return Promise.resolve();

    const write = this.conversationWrites.then(async () => {
      const id = getConversationIdentifierFromMessage(rumor);
      const existing = await this.conversationIndex.get(id);
      if (!isNewerThan(rumor, existing)) return;

      const entry = { id, lastMessageId: rumor.id, lastActivity: rumor.created_at };
      await this.conversationIndex.set(entry);
      this.conversationUpdates.next(await this.summarizeConversation(entry, rumor));
    });
    this.conversationWrites = write.catch(() => undefined);

    return write;
  }

  private async summarizeConversation(
    entry: WrappedConversationIndexEntry,
    lastMessage?: Rumor,
  ): Promise<WrappedConversationSummary> {
    const message = lastMessage ?? (await this.rumorStore.getEvent(entry.lastMessageId));

    return {
      id: entry.id,
      participants: getConversationParticipants(entry.id),
      lastMessage: message ?? undefined,
      lastActivity: entry.lastActivity,
    };
  }

  private assertActive() {
    if (this.disposed) throw new Error("Messages client disposed");
  }

  /**
   * Authenticates a pending relay through its receiving or publication owner
   * @throws if the client is disposed, no matching signer or request exists, or authentication fails
   */
  authenticate(url: string): Promise<void> {
    const context = this.context();
    return firstValueFrom(
      defer(async () => {
        const receiving = await firstValueFrom(this.receiver.authRequests$);
        context.signal.throwIfAborted();
        const owner = receiving.some((request) => request.url === url) ? this.receiver : this.authentication;
        await owner.authenticate(url);
      }).pipe(takeUntil(fromEvent(context.signal, "abort"))),
    );
  }

  /**
   * Authenticates the current pending challenges sequentially and returns per-relay outcomes
   * @throws if the client is disposed or stop/dispose cancels the batch
   */
  authenticateAll(): Promise<MessageAuthenticationResult[]> {
    const context = this.context();
    return firstValueFrom(
      defer(async () => {
        const requests = await firstValueFrom(this.authRequests$);
        const results: MessageAuthenticationResult[] = [];
        for (const { url } of requests) {
          context.signal.throwIfAborted();
          const pending = await firstValueFrom(this.authRequests$);
          if (!pending.some((request) => request.url === url)) {
            results.push({ url, status: "skipped" });
            continue;
          }
          try {
            await this.authenticate(url);
            results.push({ url, status: "authenticated" });
          } catch (error) {
            context.signal.throwIfAborted();
            results.push({ url, status: "failed", error });
          }
        }
        return results;
      }).pipe(takeUntil(fromEvent(context.signal, "abort"))),
    );
  }

  private context(options: MessageOperationOptions = {}) {
    this.assertActive();
    const signal = options.signal ? AbortSignal.any([this.generation.signal, options.signal]) : this.generation.signal;
    signal.throwIfAborted();

    return { ...options, signal };
  }

  private report(operation: MessageClientError["operation"], error: unknown, eventId?: string) {
    this.errors.next({ operation, error, eventId });
  }

  /**
   * Returns a stable local conversation without starting inbox loading
   * @throws if the client is disposed
   */
  conversation(participants: string | string[]): WrappedConversation {
    this.assertActive();
    const id = createConversationIdentifier(this.pubkey, getConversationParticipants(participants));
    let entry = this.conversationInstances.get(id);
    if (!entry) {
      const drafts = new ConversationDraftState(
        `draft:${id}`,
        this.options.draftStorage,
        this.options.draftFileStorage,
      );
      const conversation = new WrappedConversation(this, id, drafts);
      entry = { conversation, drafts };
      this.conversationInstances.set(id, entry);
    }

    return entry.conversation;
  }

  /** Starts owned receiving and reconciliation, or attaches to an application-managed receiver */
  async start(): Promise<void> {
    this.assertActive();
    if (this.background) return;

    const background = (this.background = new Subscription());
    const context = this.context();
    this.lifecycle.next("loading");

    try {
      if (!this.ownsReceiver) {
        this.lifecycle.next("ready");
        return;
      }

      await this.receiver.start();
      if (context.signal.aborted || background.closed) return;
      // A failed checkpoint restore can stop receiving after start() has returned.
      background.add(
        this.receiver.lifecycle$.subscribe((lifecycle) => {
          if (lifecycle !== "running" && this.background === background) this.stop();
        }),
      );
      if (context.signal.aborted || background.closed) return;
      const since = unixNow() - (this.options.historySpan ?? 30 * 86400);
      background.add(
        this.receiver
          .sync$({ since: Math.max(0, since - TWO_DAYS), signal: context.signal })
          .pipe(
            map((mailbox) => ({ mailboxes: [mailbox], done: mailbox.done, loaded: mailbox.loaded })),
            catchError((error) => {
              this.report("sync", error);
              return EMPTY;
            }),
          )
          .subscribe((status) => {
            this.syncState.next(status);
            if (status.done) this.lifecycle.next("ready");
          }),
      );
    } catch (error) {
      if (context.signal.aborted) return;
      this.stop();
      this.report("read", error);
      throw error;
    }
  }

  /** Stops background work and invalidates outstanding operations without disposing shared dependencies */
  stop(): void {
    this.authentication.clear();
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;
    if (this.ownsReceiver) this.receiver.stop();

    if (!this.disposed) this.lifecycle.next("idle");
  }

  /** Releases client subscriptions, draft state, and an internally created receiver */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.stop();
    this.subscriptions.unsubscribe();
    this.conversationUpdates.complete();
    if (this.ownsReceiver) this.receiver.dispose();
    this.session.close();
    for (const { drafts } of this.conversationInstances.values()) drafts.dispose();
    this.conversationInstances.clear();
    this.destroyed.next();
    this.destroyed.complete();
    this.lifecycle.next("disposed");
    this.publications.next({});
  }

  /** Releases this client when leaving a using scope */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Sets receiver-wide automatic decryption, including other consumers of an injected receiver
   * @throws if the client or receiver is disposed
   */
  setAutoUnlock(enabled: boolean): void {
    this.assertActive();
    this.receiver.setAutoUnlock(enabled);
  }

  /** Decrypts one envelope or all currently loaded pending envelopes */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    if (event) await this.receiver.unlock(event, context);
    else await this.receiver.unlock(undefined, context);
  }

  /** Retries a failed envelope explicitly */
  async retryDecryption(event: NostrEvent): Promise<void> {
    await this.unlock(event);
  }

  /** Reconciles inbox history with randomized-timestamp overlap */
  sync$(options: WrappedMessageHistoryOptions = {}): Observable<WrappedMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      return this.receiver
        .sync$({
          ...context,
          since: Math.max(0, (options.since ?? 0) - TWO_DAYS),
          until: options.until,
          followRelays: false,
        })
        .pipe(
          map((mailbox) => ({ mailboxes: [mailbox], done: mailbox.done, loaded: mailbox.loaded })),
          takeUntil(fromEvent(context.signal, "abort")),
        );
    });
  }

  /** Loads a finite inbox range; conversations are filtered locally after decryption */
  async loadHistory(options: WrappedMessageHistoryOptions = {}): Promise<WrappedMessagesSyncStatus> {
    return lastValueFrom(this.sync$(options));
  }

  /**
   * Pages through the conversation index newest activity first, reading each newest message from the rumor store
   * @throws if the client is disposed, the signal aborts, or the index store fails
   */
  async *conversations(options: WrappedConversationListOptions = {}): AsyncGenerator<WrappedConversationSummary> {
    this.assertActive();
    options.signal?.throwIfAborted();

    for await (const entry of this.conversationIndex.list({ until: options.until })) {
      const summary = await this.summarizeConversation(entry);
      this.assertActive();
      options.signal?.throwIfAborted();
      yield summary;
    }
  }

  /**
   * Indexes rumors already in the rumor store, such as messages decrypted before the index existed
   * @returns the number of rumors scanned
   * @throws if the client is disposed or stopped, the signal aborts, or the rumor store or index store fails
   */
  async indexConversations(options: WrappedConversationIndexingOptions = {}): Promise<number> {
    const context = this.context(options);
    const { since } = options;
    let until = options.until;
    let scanned = 0;

    while (until === undefined || since === undefined || until >= since) {
      const page = await this.rumorStore.getTimeline(this.indexingFilters({ since, until, limit: INDEXING_PAGE_SIZE }));
      context.signal.throwIfAborted();
      if (page.length === 0) break;

      // The page may end partway through its oldest second, so read that whole second separately
      const oldest = Math.min(...page.map((rumor) => rumor.created_at));
      const newer = page.filter((rumor) => rumor.created_at > oldest);
      const oldestSecond = await this.rumorStore.getTimeline(this.indexingFilters({ since: oldest, until: oldest }));
      context.signal.throwIfAborted();

      for (const rumor of [...newer, ...oldestSecond]) {
        await this.recordConversation(rumor);
        context.signal.throwIfAborted();
      }

      scanned += newer.length + oldestSecond.length;
      until = oldest - 1;
    }

    return scanned;
  }

  private indexingFilters(window: { since?: number; until?: number; limit?: number }): Filter[] {
    const bounds: Filter = {};
    if (window.since !== undefined) bounds.since = window.since;
    if (window.until !== undefined) bounds.until = window.until;
    if (window.limit !== undefined) bounds.limit = window.limit;

    return this.messageFilters.map((filter) => ({ ...filter, ...bounds }));
  }

  /** Discovers kind-10050 relays for every participant, including the owner */
  async discover(
    request: WrappedMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<WrappedMessageAvailability> {
    const context = this.context(options);
    return firstValueFrom(this.session.discover$(request, context).pipe(takeUntil(fromEvent(context.signal, "abort"))));
  }

  /** Prepares every encrypted envelope without publishing */
  async prepareSend(
    request: WrappedMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<PreparedWrappedMessage> {
    const context = this.context(options);
    const generation = this.generation.signal;
    if (!this.signer?.nip44) throw new Error("Signer does not support this message protocol");
    const signerPubkey = await firstValueFrom(
      defer(() => this.signer!.getPublicKey()).pipe(
        timeout({ first: this.options.actionTimeout ?? 120000 }),
        takeUntil(fromEvent(context.signal, "abort")),
      ),
    );
    if (signerPubkey !== this.pubkey) throw new Error("Signer does not match the messages client owner");
    context.signal.throwIfAborted();
    const prepared = await firstValueFrom(
      this.session.prepareSend$(request, context).pipe(takeUntil(fromEvent(context.signal, "abort"))),
    );
    const setState = (state: "prepared" | "publishing" | "accepted" | "failed") =>
      this.publications.next({ ...this.publications.value, [prepared.message.id]: state });
    setState("prepared");
    return {
      message: prepared.message,
      get publications() {
        return prepared.publications;
      },
      publish: async (publishOptions = {}) => {
        const publication = this.context(publishOptions);
        generation.throwIfAborted();
        this.sending.next(this.sending.value + 1);
        setState("publishing");

        try {
          const message = await firstValueFrom(
            prepared.publish$(publication).pipe(takeUntil(fromEvent(publication.signal, "abort"))),
          );
          publication.signal.throwIfAborted();
          setState("accepted");
          return message;
        } catch (error) {
          setState("failed");
          this.report("send", error);
          throw error;
        } finally {
          this.sending.next(this.sending.value - 1);
        }
      },
    };
  }

  /**
   * Encrypts a file and uploads the ciphertext, returning the metadata for a file message
   * @throws if no uploader is configured or the upload fails
   */
  async uploadFile(
    file: Blob,
    options: MessageOperationOptions & UploadEncryptedFileOptions = {},
  ): Promise<FileMetadataFields> {
    if (!this.options.upload) throw new Error("No file uploader configured");

    const context = this.context(options);
    return uploadEncryptedFile(file, this.options.upload, { metadata: options.metadata, signal: context.signal });
  }

  /** Publishes one envelope per participant and retains failed envelopes for retry */
  async send(request: WrappedMessageSendRequest, options: MessageOperationOptions = {}): Promise<Rumor> {
    return (await this.prepareSend(request, options)).publish(options);
  }

  /** Replies to every participant in a wrapped conversation */
  async reply(
    parent: Rumor,
    content: string,
    options: MessageOperationOptions & { expiration?: number; envelopeExpiration?: number } = {},
  ): Promise<Rumor> {
    return this.send(
      {
        recipients: getConversationParticipants(parent),
        content,
        replyTo: parent.id,
        expiration: options.expiration,
        envelopeExpiration: options.envelopeExpiration,
      },
      options,
    );
  }
}
