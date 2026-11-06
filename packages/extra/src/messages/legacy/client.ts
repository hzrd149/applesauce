import {
  createConversationIdentifier,
  getConversationParticipants,
  getLegacyMessageCorrespondent,
  isValidLegacyMessage,
} from "applesauce-common/helpers";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import { MemoryConversationIndexStore, recordConversationMessage } from "../common/conversation-index.js";
import { pageTimeline, type TimelineWindow } from "../common/helpers.js";
import { isHexKey, type NostrEvent } from "applesauce-core/helpers";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinct,
  EMPTY,
  filter,
  take,
  firstValueFrom,
  from,
  fromEvent,
  lastValueFrom,
  map,
  Observable,
  ReplaySubject,
  Subscription,
  Subject,
  takeUntil,
  toArray,
} from "rxjs";
import {
  authenticateSequentially,
  MessageAuthentication,
  type MessageAuthenticationResult,
} from "../common/authentication.js";
import type {
  ConversationIndexEntry,
  ConversationIndexingOptions,
  ConversationIndexStore,
  MessageOperationOptions,
} from "../common/types.js";
import { LegacyConversation } from "./conversation.js";
import { LegacyInboxReceiver } from "./inbox-receiver.js";
import type {
  LegacyConversationSummary,
  LegacyDecryptionState,
  LegacyMessageAvailability,
  LegacyMessageHistoryOptions,
  LegacyMessageSendRequest,
  LegacyMessagesClientOptions,
  LegacyMessagesSyncStatus,
  LegacyMailboxError,
  PreparedLegacyMessage,
} from "./types.js";

/** The number of events read from the event cache per filter while indexing conversations */
const INDEXING_PAGE_SIZE = 500;

function validateRecipient(request: LegacyMessageSendRequest) {
  if (!isHexKey(request.recipient)) throw new Error("Invalid recipient");
}

/** An account-scoped NIP-04 inbox with loading, decryption and reliable publication */
export class LegacyMessagesClient {
  /** The immutable owner pubkey */
  readonly pubkey: string;

  /** The shared event store */
  readonly eventStore;

  /** The shared relay pool */
  readonly pool;

  /** The account signer, absent for read-only browsing */
  readonly signer;

  /** The account-wide receiver loading and decrypting the owner's inbox and outbox relays */
  readonly receiver: LegacyInboxReceiver;
  private readonly ownsReceiver: boolean;

  /** The native encrypted kind-4 events, including sent messages */
  readonly messages$: Observable<NostrEvent[]>;

  /** The combined mailbox relay set */
  readonly relays$: Observable<string[]>;

  /** The live mailbox subscription failures, including their direction and requested relays */
  readonly mailboxErrors$: Observable<LegacyMailboxError>;

  /** The current decryption snapshot for loaded account messages */
  readonly decryptionState$: Observable<LegacyDecryptionState>;

  private readonly lifecycle = new BehaviorSubject<"idle" | "running" | "disposed">("idle");

  /** The background work lifecycle, independent of operation success */
  readonly lifecycle$ = this.lifecycle.asObservable();

  /** The latest event-cache hydration error, cleared by successful hydration */
  readonly cacheError$: Observable<unknown | undefined>;

  private readonly conversationIndexError = new BehaviorSubject<unknown | undefined>(undefined);

  /** The latest conversation index read or write error, cleared by the next successful write */
  readonly conversationIndexError$ = this.conversationIndexError.asObservable();

  private readonly conversationIndex: ConversationIndexStore;
  private readonly conversationInserts = new Subject<LegacyConversationSummary>();
  private readonly conversationUpdates = new Subject<LegacyConversationSummary>();

  /** The conversations added to the index, for adding to pages loaded with conversations() */
  readonly conversationInserts$ = this.conversationInserts.asObservable();

  /** The indexed conversations whose newest message changed, for replacing them in pages loaded with conversations() */
  readonly conversationUpdates$ = this.conversationUpdates.asObservable();

  // Serializes index writes so live arrivals and indexConversations() never overwrite each other
  private conversationWrites: Promise<unknown> = Promise.resolve();

  /** Whether stored messages are automatically unlocked, disabled by default */
  readonly autoUnlock$: Observable<boolean>;

  private readonly conversationInstances = new BehaviorSubject<readonly LegacyConversation[]>([]);

  private readonly authentication: MessageAuthentication;

  /** The pending relay authentication requests for receiving and publishing */
  readonly authRequests$;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;
  private readonly destroyed = new ReplaySubject<void>(1);
  private readonly lifetime = new Subscription();

  /**
   * Creates a stopped legacy client using shared application dependencies
   * @throws if an injected receiver does not match the account, store, or pool, or is combined with receiverOptions
   */
  constructor(private readonly options: LegacyMessagesClientOptions) {
    if (options.receiver && options.receiverOptions)
      throw new Error("Receiver and receiverOptions are mutually exclusive");
    if (
      options.receiver &&
      (options.receiver.pubkey !== options.pubkey ||
        options.receiver.eventStore !== options.eventStore ||
        options.receiver.pool !== options.pool)
    )
      throw new Error("Receiver must match the client account, event store, and relay pool");

    this.ownsReceiver = !options.receiver;
    this.receiver =
      options.receiver ??
      new LegacyInboxReceiver({
        signer: options.signer,
        cacheRequest: options.cacheRequest,
        decryptionCache: options.decryptionCache,
        fallbackRelays: options.fallbackRelays,
        autoUnlock: options.autoUnlock,
        onAuthRequired: options.onAuthRequired,
        authTimeout: options.authTimeout,
        timeout: options.timeout,
        decryptionTimeout: options.decryptionTimeout,
        historySpan: options.historySpan,
        ...options.receiverOptions,
        pubkey: options.pubkey,
        eventStore: options.eventStore,
        pool: options.pool,
      });

    // Publishing keeps its own authentication so an injected receiver does not change sending prompts.
    this.authentication = new MessageAuthentication(options.pool, options.pubkey, options.signer);
    this.authRequests$ = combineLatest([this.authentication.requests$, this.receiver.authRequests$]).pipe(
      map(([publishing, receiving]) => [
        ...new Map([...publishing, ...receiving].map((request) => [request.url, request])).values(),
      ]),
      takeUntil(this.destroyed),
    );
    options = this.options = { ...options, ...this.authentication.configure(options) };
    this.pubkey = options.pubkey;
    this.eventStore = options.eventStore;
    this.pool = options.pool;
    this.signer = options.signer;

    this.messages$ = this.receiver.messages$;
    this.relays$ = this.receiver.relays$;
    this.decryptionState$ = this.receiver.decryptionState$;
    this.autoUnlock$ = this.receiver.autoUnlock$;
    this.cacheError$ = this.receiver.cacheError$;
    this.mailboxErrors$ = this.receiver.errors$.pipe(
      filter((error) => error.operation === "read" && error.mailbox !== undefined),
      map(({ mailbox, relays, error }) => ({ mailbox: mailbox!, relays: relays ?? [], error })),
      takeUntil(this.destroyed),
    );

    this.conversationIndex = options.conversationIndex ?? new MemoryConversationIndexStore();

    // Index failures are reported without stopping the subscription, so the next message is still recorded.
    this.lifetime.add(
      this.eventStore
        .filters(this.filters)
        .pipe(
          concatMap((event) =>
            defer(() => this.recordConversation(event)).pipe(
              catchError((error) => {
                this.conversationIndexError.next(error);
                return EMPTY;
              }),
            ),
          ),
        )
        .subscribe(),
    );
  }

  private get filters() {
    return this.receiver.filters;
  }

  /** Records a message as its conversation's newest activity when it is newer than the indexed message */
  private recordConversation(event: NostrEvent): Promise<void> {
    if (!isValidLegacyMessage(event)) return Promise.resolve();

    const correspondent = getLegacyMessageCorrespondent(event, this.pubkey);
    if (!correspondent || !isHexKey(correspondent)) return Promise.resolve();

    const write = this.conversationWrites.then(async () => {
      const id = createConversationIdentifier(this.pubkey, [correspondent]);
      const recorded = await recordConversationMessage(this.conversationIndex, id, event);
      this.conversationIndexError.next(undefined);
      if (!recorded) return;

      const summary = this.summarizeConversation(recorded.entry, event);
      if (recorded.inserted) this.conversationInserts.next(summary);
      else this.conversationUpdates.next(summary);
    });
    this.conversationWrites = write.catch(() => undefined);

    return write;
  }

  private summarizeConversation(entry: ConversationIndexEntry, lastMessage?: NostrEvent): LegacyConversationSummary {
    const participants = getConversationParticipants(entry.id);

    // A conversation with yourself has only the owner as a participant
    const correspondent = participants.find((pubkey) => pubkey !== this.pubkey) ?? this.pubkey;

    return {
      id: entry.id,
      correspondent,
      participants,
      lastMessage: lastMessage ?? this.eventStore.getEvent(entry.lastMessageId) ?? undefined,
      lastActivity: entry.lastActivity,
    };
  }

  /**
   * Pages through the conversation index newest activity first, reading each newest message from the event store
   * @throws if the client is disposed, the signal aborts, or the index store fails
   */
  async *conversations(options: MessageOperationOptions = {}): AsyncGenerator<LegacyConversationSummary> {
    this.assertActive();
    options.signal?.throwIfAborted();

    for await (const entry of this.conversationIndex.list()) {
      this.assertActive();
      options.signal?.throwIfAborted();
      yield this.summarizeConversation(entry);
    }
  }

  /**
   * Indexes messages in the event cache, such as messages cached before the index existed
   * @returns the number of cached messages scanned, or zero without a cacheRequest
   * @throws if the client is disposed or stopped, the signal aborts, or the event cache or index store fails
   */
  async indexConversations(options: ConversationIndexingOptions = {}): Promise<number> {
    const context = this.context(options);
    const cacheRequest = this.options.cacheRequest;
    if (!cacheRequest) return 0;

    const read = (window: TimelineWindow) => {
      const filters = this.filters.map((filter) => ({ ...filter, ...window }));
      return lastValueFrom(makeCacheRequest(cacheRequest, filters).pipe(toArray()));
    };
    let scanned = 0;

    for await (const event of pageTimeline(read, { ...options, pageSize: INDEXING_PAGE_SIZE })) {
      context.signal.throwIfAborted();
      await this.recordConversation(event);
      scanned++;
    }

    context.signal.throwIfAborted();
    return scanned;
  }

  private assertActive() {
    if (this.disposed) throw new Error("Messages client disposed");
  }

  /**
   * Authenticates a pending relay through its receiving or publishing owner
   * @throws if the client is disposed, no matching signer or request exists, or authentication fails
   */
  authenticate(url: string): Promise<void> {
    this.context();

    const owner = this.receiver.hasAuthRequest(url) ? this.receiver : this.authentication;
    return owner.authenticate(url);
  }

  /**
   * Authenticates the current pending challenges sequentially and returns per-relay outcomes
   * @throws if the client is disposed or stop/dispose cancels the batch
   */
  authenticateAll(): Promise<MessageAuthenticationResult[]> {
    const context = this.context();

    const requests = [...this.authentication.currentRequests, ...this.receiver.currentAuthRequests];
    const urls = [...new Set(requests.map((request) => request.url))];
    const isPending = (url: string) => this.authentication.hasRequest(url) || this.receiver.hasAuthRequest(url);

    return authenticateSequentially(urls, isPending, (url) => this.authenticate(url), context.signal);
  }

  private context(options: MessageOperationOptions = {}) {
    this.assertActive();
    const signal = options.signal ? AbortSignal.any([this.generation.signal, options.signal]) : this.generation.signal;
    signal.throwIfAborted();

    return { ...options, signal };
  }

  /** Returns the native messages in one conversation */
  conversation$(correspondent: string): Observable<NostrEvent[]> {
    return this.conversation(correspondent).messages$;
  }

  /** Returns a stable, independently loadable conversation with one correspondent */
  conversation(correspondent: string): LegacyConversation {
    this.assertActive();
    if (!isHexKey(correspondent)) throw new Error("Invalid correspondent");
    let conversation = this.conversationInstances.value.find(
      (conversation) => conversation.correspondent === correspondent,
    );
    if (!conversation || conversation.isDisposed) {
      conversation = new LegacyConversation(this, correspondent, {
        ...this.options,
        autoUnlock: this.receiver.autoUnlockEnabled,
      });
      this.conversationInstances.next([
        ...this.conversationInstances.value.filter((item) => !item.isDisposed),
        conversation,
      ]);
      this.observeConversation(conversation);
    }

    return conversation;
  }

  private observeConversation(conversation: LegacyConversation): void {
    const disposed$ = conversation.lifecycle$.pipe(filter((lifecycle) => lifecycle === "disposed"));
    this.lifetime.add(
      disposed$.pipe(take(1)).subscribe(() => {
        this.conversationInstances.next(this.conversationInstances.value.filter((item) => item !== conversation));
      }),
    );
  }

  /** Starts cache restoration and live mailbox loading without reconciling history, or attaches to an application-managed receiver */
  async start(): Promise<void> {
    this.assertActive();
    if (this.background) return;

    const background = (this.background = new Subscription());
    const context = this.context();
    this.lifecycle.next("running");
    if (!this.ownsReceiver) return;

    try {
      await this.receiver.start();
      if (context.signal.aborted || background.closed) return;
    } catch (error) {
      if (this.background === background) this.stop();
      throw error;
    }
  }

  /** Stops background work and invalidates outstanding operations without disposing shared dependencies */
  stop(): void {
    this.authentication.clear();
    for (const conversation of this.conversationInstances.value) conversation.stop();
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;
    if (this.ownsReceiver) this.receiver.stop();

    if (!this.disposed && this.lifecycle.value !== "idle") this.lifecycle.next("idle");
  }

  /** Permanently releases this client's subscriptions, conversations and an internally created receiver */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.stop();

    for (const conversation of this.conversationInstances.value) conversation.dispose();
    this.conversationInstances.next([]);
    this.lifetime.unsubscribe();
    this.conversationInserts.complete();
    this.conversationUpdates.complete();
    if (this.ownsReceiver) this.receiver.dispose();
    this.destroyed.next();
    this.destroyed.complete();
    this.lifecycle.next("disposed");
  }

  /** Releases this client and its conversations through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Enables or disables signer-backed decryption of arriving messages, including other consumers of an injected receiver
   * @throws if the client or receiver is disposed
   */
  setAutoUnlock(enabled: boolean): void {
    this.assertActive();
    this.receiver.setAutoUnlock(enabled);
    for (const conversation of this.conversationInstances.value) conversation.setAutoUnlock(enabled);
  }

  /** Decrypts one event or all currently loaded pending events */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    await this.receiver.unlock(event, context);
  }

  /** Retries a failed decryption explicitly */
  async retryDecryption(event: NostrEvent): Promise<void> {
    await this.unlock(event);
  }

  /** Reconciles a history range while following mailbox relay changes by default */
  sync$(options: LegacyMessageHistoryOptions = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      const { correspondent, ...range } = options;

      if (correspondent) return this.conversation(correspondent).sync$({ ...range, signal: context.signal });
      return this.receiver.sync$({ ...range, signal: context.signal });
    });
  }

  /** Loads a finite history range and returns its final reconciliation status */
  async loadHistory(options: LegacyMessageHistoryOptions = {}): Promise<LegacyMessagesSyncStatus> {
    return lastValueFrom(this.sync$({ ...options, followRelays: false }));
  }

  /** Reads decrypted messages from a stored snapshot or watches the store for additions */
  readMessages$(options: MessageOperationOptions & { history?: boolean } = {}): Observable<NostrEvent> {
    return defer(() => {
      const context = this.context(options);
      const events$ = options.history
        ? from(this.eventStore.getByFilters(this.filters))
        : this.eventStore.filters(this.filters);

      return events$.pipe(
        distinct((event) => event.id),
        concatMap((event) => this.receiver.decryptor.read$(event).pipe(catchError(() => EMPTY))),
        takeUntil(fromEvent(context.signal, "abort")),
      );
    });
  }

  /** Observes recipient relay support and follows relay configuration changes */
  discover$(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Observable<LegacyMessageAvailability> {
    return defer(() => {
      const context = this.context(options);
      validateRecipient(request);
      return this.conversation(request.recipient).discover$(context);
    });
  }

  /** Discovers relay support before preparing a send */
  discover(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<LegacyMessageAvailability> {
    return firstValueFrom(this.discover$(request, options));
  }

  /** Prepares an encrypted event through its recipient's conversation */
  async prepareSend(
    request: LegacyMessageSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<PreparedLegacyMessage> {
    const context = this.context(options);
    validateRecipient(request);
    return this.conversation(request.recipient).prepareSend(request, context);
  }

  /** Prepares and publishes a message through its recipient's conversation */
  async send(request: LegacyMessageSendRequest, options: MessageOperationOptions = {}): Promise<NostrEvent> {
    const context = this.context(options);
    validateRecipient(request);
    return this.conversation(request.recipient).send(request, context);
  }

  /** Replies to a legacy message */
  async reply(
    parent: NostrEvent,
    content: string,
    options: MessageOperationOptions & { expiration?: number } = {},
  ): Promise<NostrEvent> {
    const recipient = getLegacyMessageCorrespondent(parent, this.pubkey);
    if (!recipient) throw new Error("Message does not belong to this owner");
    return this.conversation(recipient).reply(parent, content, {
      ...this.context(options),
      expiration: options.expiration,
    });
  }
}
