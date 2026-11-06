import { logger } from "applesauce-core";
import { isNIP04Encrypted } from "applesauce-core/helpers/encryption";
import { castUser } from "applesauce-common/casts";
import {
  createConversationIdentifier,
  getConversationParticipants,
  getLegacyMessageCorrespondent,
  isValidLegacyMessage,
  unlockLegacyMessage,
} from "applesauce-common/helpers";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import { createSyncLoader } from "applesauce-loaders/loaders";
import { MemoryConversationIndexStore, recordConversationMessage } from "../common/conversation-index.js";
import { configured$, pageTimeline, withFallback$, type TimelineWindow } from "../common/helpers.js";
import {
  isHexKey,
  mergeRelaySets,
  unixNow,
  kinds,
  isEncryptedContentFromCache,
  isEncryptedContentUnlocked,
  isPTag,
  restoreEncryptedContent,
  saveEncryptedContent,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { mapEventsToStore, watchEventsUpdates } from "applesauce-core/observable";
import {
  BehaviorSubject,
  concat,
  finalize,
  ignoreElements,
  shareReplay,
  startWith,
  switchMap,
  timeout,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinct,
  distinctUntilChanged,
  EMPTY,
  filter,
  take,
  firstValueFrom,
  from,
  fromEvent,
  lastValueFrom,
  map,
  merge,
  Observable,
  of,
  Subscription,
  Subject,
  takeUntil,
  tap,
  toArray,
} from "rxjs";
import { MessageAuthentication, type MessageAuthenticationResult, withMessageAuth$ } from "../common/authentication.js";
import type {
  ConversationIndexEntry,
  ConversationIndexingOptions,
  ConversationIndexStore,
  ConversationListOptions,
  MessageClientError,
  MessageOperationOptions,
} from "../common/types.js";
import { LegacyConversation } from "./conversation.js";
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

const log = logger.extend("LegacyMessages");
type DecryptionActivity = { readers: number; failed: boolean; error?: unknown };
type Mailbox = { name: "incoming" | "outgoing"; filter: Filter; relays$: Observable<string[]> };

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

  /** The native encrypted kind-4 events, including sent messages */
  readonly messages$: Observable<NostrEvent[]>;

  /** The combined mailbox relay set */
  readonly relays$: Observable<string[]>;

  private readonly mailboxErrors = new Subject<LegacyMailboxError>();

  /** The live mailbox subscription failures, including their direction and requested relays */
  readonly mailboxErrors$ = this.mailboxErrors.asObservable();

  /** The current decryption snapshot for loaded account messages */
  readonly decryptionState$: Observable<LegacyDecryptionState>;

  private readonly lifecycle = new BehaviorSubject<"idle" | "running" | "disposed">("idle");

  /** The background work lifecycle, independent of operation success */
  readonly lifecycle$ = this.lifecycle.asObservable();

  private readonly cacheError = new BehaviorSubject<unknown | undefined>(undefined);

  /** The latest event-cache hydration error, cleared by successful hydration */
  readonly cacheError$ = this.cacheError.asObservable();

  private readonly conversationIndexError = new BehaviorSubject<unknown | undefined>(undefined);

  /** The latest conversation index read or write error, cleared by the next successful write */
  readonly conversationIndexError$ = this.conversationIndexError.asObservable();

  private readonly conversationIndex: ConversationIndexStore;
  private readonly conversationUpdates = new Subject<LegacyConversationSummary>();

  /** The conversations whose newest message changed, for updating pages loaded with conversations() */
  readonly conversationUpdates$ = this.conversationUpdates.asObservable();

  // Serializes index writes so live arrivals and indexConversations() never overwrite each other
  private conversationWrites: Promise<unknown> = Promise.resolve();

  private readonly autoUnlock = new BehaviorSubject(false);

  /** Whether stored messages are automatically unlocked, disabled by default */
  readonly autoUnlock$ = this.autoUnlock.asObservable();

  private readonly conversationInstances = new BehaviorSubject<readonly LegacyConversation[]>([]);

  private readonly decryptionActivity = new BehaviorSubject<ReadonlyMap<string, DecryptionActivity>>(new Map());
  private readonly pendingDecryptions = new Map<string, Promise<NostrEvent | undefined>>();
  private signerDecryptionQueue: Promise<void> = Promise.resolve();

  private readonly authentication: MessageAuthentication;

  /** The pending relay authentication requests */
  readonly authRequests$;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;
  private readonly mailboxes: Mailbox[];
  private readonly lifetime = new Subscription();

  /** Creates a stopped legacy client using shared application dependencies */
  constructor(private readonly options: LegacyMessagesClientOptions) {
    this.authentication = new MessageAuthentication(options.pool, options.pubkey, options.signer);
    this.authRequests$ = this.authentication.requests$;
    options = this.options = { ...options, ...this.authentication.configure(options) };
    this.pubkey = options.pubkey;
    this.eventStore = options.eventStore;
    this.pool = options.pool;
    this.signer = options.signer;
    this.autoUnlock.next(options.autoUnlock ?? false);

    const owner = castUser(this.pubkey, this.eventStore);
    this.mailboxes = [
      {
        name: "incoming",
        filter: { kinds: [kinds.EncryptedDirectMessage], "#p": [this.pubkey] },
        relays$: this.mailboxRelays$([owner.inboxes$, owner.directMessageRelays$]),
      },
      {
        name: "outgoing",
        filter: { kinds: [kinds.EncryptedDirectMessage], authors: [this.pubkey] },
        relays$: this.mailboxRelays$([owner.outboxes$]),
      },
    ];
    this.relays$ = combineLatest(this.mailboxes.map((mailbox) => mailbox.relays$)).pipe(
      map((relays) => mergeRelaySets(...relays)),
      distinctUntilChanged((a, b) => a.join() === b.join()),
    );

    // Decryption updates cached content without replacing the stored event.
    this.messages$ = this.eventStore.timeline(this.filters).pipe(watchEventsUpdates(this.eventStore));

    this.decryptionState$ = this.observeDecryption$(this.messages$);
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
    return this.mailboxes.map((mailbox) => mailbox.filter);
  }

  /** Records a message as its conversation's newest activity when it is newer than the indexed message */
  private recordConversation(event: NostrEvent): Promise<void> {
    if (!isValidLegacyMessage(event)) return Promise.resolve();

    const correspondent = getLegacyMessageCorrespondent(event, this.pubkey);
    if (!correspondent || !isHexKey(correspondent)) return Promise.resolve();

    const write = this.conversationWrites.then(async () => {
      const id = createConversationIdentifier(this.pubkey, [correspondent]);
      const entry = await recordConversationMessage(this.conversationIndex, id, event);
      this.conversationIndexError.next(undefined);
      if (!entry) return;

      this.conversationUpdates.next(this.summarizeConversation(entry, event));
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
  async *conversations(options: ConversationListOptions = {}): AsyncGenerator<LegacyConversationSummary> {
    this.assertActive();
    options.signal?.throwIfAborted();

    for await (const entry of this.conversationIndex.list({ until: options.until })) {
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
   * Authenticates a pending relay using this client's signer
   * @throws if the client is disposed, no matching signer or request exists, or authentication fails
   */
  authenticate(url: string): Promise<void> {
    this.assertActive();
    return this.authentication.authenticate(url);
  }

  /**
   * Authenticates the current pending challenges sequentially and returns per-relay outcomes
   * @throws if the client is disposed or stop/dispose cancels the batch
   */
  authenticateAll(): Promise<MessageAuthenticationResult[]> {
    this.assertActive();
    return this.authentication.authenticateAll();
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
        autoUnlock: this.autoUnlock.value,
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

  /** Starts cache restoration and live mailbox loading without reconciling history */
  async start(): Promise<void> {
    this.assertActive();
    if (this.background) return;

    const background = (this.background = new Subscription());
    const context = this.context();
    this.lifecycle.next("running");

    try {
      await lastValueFrom(this.hydrate$(this.filters, context.signal), { defaultValue: undefined });
      if (context.signal.aborted || background.closed) return;

      const since = unixNow() - (this.options.historySpan ?? 30 * 86400);
      const decryption$ = this.watchDecryption$(this.eventStore.filters(this.filters), this.autoUnlock);
      const live$ = merge(...this.mailboxes.map((mailbox) => this.watchMailbox$(mailbox, since)));
      background.add(merge(decryption$, live$).subscribe());
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

    if (!this.disposed && this.lifecycle.value !== "idle") this.lifecycle.next("idle");
  }

  /** Permanently releases this client's subscriptions and retry state */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.stop();

    for (const conversation of this.conversationInstances.value) conversation.dispose();
    this.conversationInstances.next([]);
    this.lifetime.unsubscribe();
    this.lifecycle.next("disposed");
    this.mailboxErrors.complete();
  }

  /** Releases this client and its conversations through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Enables or disables signer-backed decryption of arriving messages */
  setAutoUnlock(enabled: boolean): void {
    this.autoUnlock.next(enabled);
    for (const conversation of this.conversationInstances.value) conversation.setAutoUnlock(enabled);
  }

  private updateDecryption(event: NostrEvent, change: (previous: DecryptionActivity) => DecryptionActivity) {
    const next = new Map(this.decryptionActivity.value);
    const updated = change(next.get(event.id) ?? { readers: 0, failed: false });
    if (!updated.readers && !updated.failed) next.delete(event.id);
    else next.set(event.id, updated);
    this.decryptionActivity.next(next);
  }

  private async restore(event: NostrEvent) {
    if (!this.options.decryptionCache || isEncryptedContentUnlocked(event)) return;
    await restoreEncryptedContent(event, this.options.decryptionCache).catch((error) => {
      log("Failed to restore encrypted content for %s", event.id, error);
    });
  }

  private async decrypt(event: NostrEvent) {
    await this.restore(event);
    // Cache reads cannot be cancelled, but abandoned readers must not prompt the signer afterward.
    if (!this.decryptionActivity.value.get(event.id)?.readers) return undefined;

    if (!isEncryptedContentUnlocked(event)) {
      if (!isNIP04Encrypted(event.content)) throw new Error("Invalid NIP-04 encrypted message content");

      const unlocking = this.signerDecryptionQueue.then(async () => {
        // Readers may leave while waiting behind another event's signer prompt.
        if (!this.decryptionActivity.value.get(event.id)?.readers || isEncryptedContentUnlocked(event)) return;
        if (!this.options.signer) throw new Error("A signer is required");
        await unlockLegacyMessage(event, this.pubkey, this.options.signer);
      });

      // Keep the queue usable after a rejection, and occupied until the signer actually settles.
      this.signerDecryptionQueue = unlocking.catch(() => undefined);
      await unlocking;
      if (!isEncryptedContentUnlocked(event)) return undefined;
    }
    if (this.options.decryptionCache && !isEncryptedContentFromCache(event)) {
      await saveEncryptedContent(event, this.options.decryptionCache).catch((error) => {
        log("Failed to persist encrypted content for %s", event.id, error);
      });
    }
    return event;
  }

  private read$(event: NostrEvent): Observable<NostrEvent> {
    return defer(() => {
      if (!isValidLegacyMessage(event)) return EMPTY;
      const addressedToOwner = event.tags.some((tag) => isPTag(tag) && tag[1] === this.options.pubkey);
      if (event.pubkey !== this.options.pubkey && !addressedToOwner) return EMPTY;

      let decryption = this.pendingDecryptions.get(event.id);
      if (!decryption) {
        decryption = this.decrypt(event);
        this.pendingDecryptions.set(event.id, decryption);
        // A timed-out or cancelled reader must still share an unresolved signer call.
        const release = () => this.pendingDecryptions.delete(event.id);
        void decryption.then(release, release);
      }
      this.updateDecryption(event, (previous) => ({ ...previous, readers: previous.readers + 1 }));

      return defer(() => decryption).pipe(
        filter((message): message is NostrEvent => message !== undefined),
        timeout({ first: this.options.decryptionTimeout ?? 60000 }),
        tap({
          next: () => this.updateDecryption(event, (previous) => ({ ...previous, failed: false, error: undefined })),
          error: (error) => {
            this.updateDecryption(event, (previous) => ({ ...previous, failed: true, error }));
          },
        }),
        finalize(() => this.updateDecryption(event, (previous) => ({ ...previous, readers: previous.readers - 1 }))),
      );
    });
  }

  /**
   * Checks whether an event needs an automatic or bulk decryption attempt
   * @internal
   */
  shouldUnlock(event: NostrEvent) {
    return !isEncryptedContentUnlocked(event) && !this.decryptionActivity.value.get(event.id)?.failed;
  }

  /**
   * Derives decryption counts for the account or one conversation
   * @internal
   */
  observeDecryption$(messages$: Observable<NostrEvent[]>): Observable<LegacyDecryptionState> {
    return combineLatest([messages$, this.decryptionActivity]).pipe(
      map(([events, operations]) => {
        let unlocked = 0;
        let pending = 0;
        const errors = new Map<string, unknown>();

        for (const event of events) {
          // Plaintext from any route takes precedence over an earlier failed attempt.
          if (isEncryptedContentUnlocked(event)) {
            unlocked++;
            continue;
          }

          const activity = operations.get(event.id);
          if (activity && activity.readers > 0) pending++;
          if (activity?.failed) errors.set(event.id, activity.error);
        }

        return {
          total: events.length,
          unlocked,
          locked: events.length - unlocked,
          pending,
          errors,
        };
      }),
    );
  }

  private processStoredMessage$(event: NostrEvent, autoUnlock: boolean, onError?: (error: MessageClientError) => void) {
    const unlock = autoUnlock && this.shouldUnlock(event);
    const operation = unlock ? "decrypt" : "restore";
    const processing$: Observable<unknown> = unlock
      ? this.read$(event)
      : defer(() => this.restore(event)).pipe(timeout({ first: this.options.decryptionTimeout ?? 60000 }));

    return processing$.pipe(
      catchError((error) => {
        if (operation === "restore") onError?.({ operation, error, eventId: event.id });
        return EMPTY;
      }),
    );
  }

  /**
   * Restores cached plaintext and optionally decrypts stored arrivals in order
   * @internal
   */
  watchDecryption$(
    events$: Observable<NostrEvent>,
    autoUnlock$: Observable<boolean>,
    onError?: (error: MessageClientError) => void,
  ) {
    return autoUnlock$.pipe(
      distinctUntilChanged(),
      // Replacing the stream drops queued work; already-running signer promises remain shared.
      switchMap((autoUnlock) =>
        events$.pipe(concatMap((event) => this.processStoredMessage$(event, autoUnlock, onError))),
      ),
    );
  }

  /** Decrypts one event or all currently loaded pending events */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const context = this.context(options);
    const events = event ? [event] : [...this.eventStore.getByFilters(this.filters)];

    for (const item of events) {
      context.signal.throwIfAborted();
      if (!event && !this.shouldUnlock(item)) continue;

      try {
        await firstValueFrom(this.read$(item).pipe(takeUntil(fromEvent(context.signal, "abort"))), {
          defaultValue: undefined,
        });
        context.signal.throwIfAborted();
      } catch (error) {
        if (event || context.signal.aborted) throw error;
      }
    }
  }

  /** Retries a failed decryption explicitly */
  async retryDecryption(event: NostrEvent): Promise<void> {
    await this.unlock(event);
  }

  private mailboxRelays$(sources: Observable<string[] | undefined>[]) {
    const fallback$ = configured$(this.options.fallbackRelays, []).pipe(catchError(() => of([])));
    return combineLatest([...sources.map((source) => source.pipe(startWith(undefined))), fallback$]).pipe(
      map((lists) => {
        const advertised = mergeRelaySets(...lists.slice(0, -1));
        return mergeRelaySets(advertised.length ? advertised : lists[lists.length - 1]).sort();
      }),
      distinctUntilChanged((previous, next) => previous.join() === next.join()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  private hydrate$(filters: Filter[], signal: AbortSignal): Observable<NostrEvent> {
    return defer(() => {
      signal.throwIfAborted();
      const cacheRequest = this.options.cacheRequest;
      if (!cacheRequest) return EMPTY;

      return defer(() => makeCacheRequest(cacheRequest, filters)).pipe(
        timeout({ each: this.options.timeout ?? 4000 }),
        mapEventsToStore(this.options.eventStore),
        tap({ complete: () => this.cacheError.next(undefined) }),
        catchError((error) => {
          this.cacheError.next(error);
          return EMPTY;
        }),
        takeUntil(fromEvent(signal, "abort")),
      );
    });
  }

  private watchMailbox$(mailbox: Mailbox, since: number) {
    return mailbox.relays$.pipe(
      switchMap((relays) => {
        if (!relays.length) return EMPTY;
        return withMessageAuth$(this.options, (auth) =>
          this.options.pool.subscription(
            relays,
            { ...mailbox.filter, since },
            { eventStore: this.options.eventStore, reconnect: true, ...auth },
          ),
        ).pipe(
          mapEventsToStore(this.options.eventStore),
          catchError((error) => {
            this.mailboxErrors.next({ mailbox: mailbox.name, relays, error });
            return EMPTY;
          }),
        );
      }),
    );
  }

  private syncRelays$(relays$: Observable<string[]>, followRelays = true) {
    if (followRelays) return relays$;
    return withFallback$(relays$.pipe(filter((relays) => relays.length > 0)), [], this.options.timeout ?? 4000).pipe(
      take(1),
    );
  }

  /** Reconciles a history range while following mailbox relay changes by default */
  sync$(options: LegacyMessageHistoryOptions = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const context = this.context(options);
      if (options.correspondent)
        return this.conversation(options.correspondent).sync$({ ...options, signal: context.signal });

      const filters = this.mailboxes.map((mailbox) => ({
        ...mailbox.filter,
        since: Math.max(0, options.since ?? 0),
        ...(options.until !== undefined ? { until: options.until } : {}),
      }));
      const sync = createSyncLoader({ pool: this.options.pool, eventStore: this.options.eventStore });
      const reconciliation$ = combineLatest(
        this.mailboxes.map((mailbox, index) =>
          withMessageAuth$(
            this.options,
            (auth) =>
              sync({
                filter: filters[index],
                relays: this.syncRelays$(mailbox.relays$, options.followRelays),
                ...auth,
              }).status$,
          ),
        ),
      );

      return concat(this.hydrate$(filters, context.signal).pipe(ignoreElements()), reconciliation$).pipe(
        map((mailboxes) => ({
          mailboxes,
          done: mailboxes.every((mailbox) => mailbox.done),
          loaded: mailboxes.reduce((sum, mailbox) => sum + mailbox.loaded, 0),
        })),
        takeUntil(fromEvent(context.signal, "abort")),
      );
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
        concatMap((event) => this.read$(event).pipe(catchError(() => EMPTY))),
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
