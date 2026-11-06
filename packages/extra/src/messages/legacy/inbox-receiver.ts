import { isHexKey, unixNow, type Filter, type NostrEvent } from "applesauce-core/helpers";
import { mapEventsToStore, watchEventsUpdates } from "applesauce-core/observable";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import {
  BehaviorSubject,
  concat,
  defer,
  EMPTY,
  fromEvent,
  ignoreElements,
  lastValueFrom,
  merge,
  Observable,
  share,
  Subject,
  Subscription,
  takeUntil,
  tap,
  timeout,
  catchError,
} from "rxjs";
import {
  MessageAuthentication,
  type MessageAuthenticationResult,
  type MessageAuthRequest,
} from "../common/authentication.js";
import type { MessageOperationOptions } from "../common/types.js";
import { LegacyMessageDecryptor } from "./decryptor.js";
import {
  combineMailboxRelays$,
  createInboxMailboxes,
  historyFilters,
  syncMailboxes$,
  watchMailbox$,
  type LegacyMailbox,
  type LegacyMailboxDependencies,
} from "./mailboxes.js";
import type {
  LegacyDecryptionState,
  LegacyInboxReceiverOptions,
  LegacyMessageHistoryOptions,
  LegacyMessagesSyncStatus,
  LegacyReadResult,
  LegacyReceiverError,
} from "./types.js";

/** An account-wide NIP-04 receiver that reads the owner's own inbox and outbox relays */
export class LegacyInboxReceiver {
  /** The immutable owner pubkey */
  readonly pubkey: string;
  /** The shared event store */
  readonly eventStore;
  /** The shared relay pool */
  readonly pool;
  /** The account signer, absent for cache-only processing */
  readonly signer;
  /** The decryptor shared with this account's conversation receivers */
  readonly decryptor: LegacyMessageDecryptor;
  /** The combined inbox and outbox relay set */
  readonly relays$: Observable<string[]>;
  /** The native incoming and outgoing kind-4 events, including plaintext updates */
  readonly messages$: Observable<NostrEvent[]>;
  /** The current decryption snapshot for loaded account messages */
  readonly decryptionState$: Observable<LegacyDecryptionState>;
  /** The pending relay authentication requests for receiving */
  readonly authRequests$;
  /** The shared stored-event processing outcomes, active only while subscribed and without relay loading */
  readonly receive$: Observable<LegacyReadResult>;
  /** The shared cache hydration, live loading and processing stream, active only while subscribed */
  readonly watch$: Observable<LegacyReadResult>;
  /** The shared live mailbox subscriptions, opened on the first subscriber and closed after the last */
  private readonly live$: Observable<never>;

  private readonly lifecycle = new BehaviorSubject<"idle" | "running" | "disposed">("idle");
  /** The explicit start/stop lifecycle, independent of history or decryption success */
  readonly lifecycle$ = this.lifecycle.asObservable();
  private readonly autoUnlock: BehaviorSubject<boolean>;
  /** Whether background processing may invoke the signer */
  readonly autoUnlock$: Observable<boolean>;
  private readonly errors = new Subject<LegacyReceiverError>();
  /** The contextual loading, cache and decryption failures */
  readonly errors$ = this.errors.asObservable();
  private readonly cacheError = new BehaviorSubject<unknown | undefined>(undefined);
  /** The latest event-cache hydration error, cleared by successful hydration */
  readonly cacheError$ = this.cacheError.asObservable();

  private readonly authentication: MessageAuthentication;
  /**
   * The receiving authentication options shared with conversation receivers
   * @internal
   */
  readonly authOptions: LegacyMailboxDependencies["authOptions"];
  private readonly mailboxes: LegacyMailbox[];
  private readonly mailboxDependencies: LegacyMailboxDependencies;
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;

  /**
   * Creates a stopped receiver with manual authentication and opt-in decryption
   * @throws if the pubkey is invalid or an injected decryptor belongs to another account
   */
  constructor(private readonly options: LegacyInboxReceiverOptions) {
    if (!isHexKey(options.pubkey)) throw new Error("Invalid receiver pubkey");
    if (options.decryptor && options.decryptor.pubkey !== options.pubkey)
      throw new Error("Decryptor must match the receiver account");

    this.pubkey = options.pubkey;
    this.eventStore = options.eventStore;
    this.pool = options.pool;
    this.signer = options.signer;
    this.decryptor =
      options.decryptor ??
      new LegacyMessageDecryptor({
        pubkey: options.pubkey,
        signer: options.signer,
        decryptionCache: options.decryptionCache,
        decryptionTimeout: options.decryptionTimeout,
      });

    this.autoUnlock = new BehaviorSubject(options.autoUnlock ?? false);
    this.autoUnlock$ = this.autoUnlock.asObservable();

    this.authentication = new MessageAuthentication(this.pool, this.pubkey, options.signer);
    this.authOptions = this.authentication.configure({
      authTimeout: options.authTimeout,
      onAuthRequired: async (context) => {
        await options.onAuthRequired?.(context);
        if (!options.autoAuth) return;

        try {
          await this.authentication.authenticate(context.url);
        } catch (error) {
          this.errors.next({ operation: "read", error });
        }
      },
    });
    this.authRequests$ = this.authentication.requests$;

    this.mailboxes = createInboxMailboxes(this.pubkey, this.eventStore, options.fallbackRelays);
    this.mailboxDependencies = {
      eventStore: this.eventStore,
      pool: this.pool,
      authOptions: this.authOptions,
      fallbackRelays: options.fallbackRelays,
      timeout: options.timeout ?? 4000,
    };
    this.relays$ = combineMailboxRelays$(this.mailboxes);

    // Decryption updates cached content without replacing the stored event.
    this.messages$ = this.eventStore.timeline(this.filters).pipe(watchEventsUpdates(this.eventStore));
    this.decryptionState$ = this.decryptor.observeState$(this.messages$);

    this.receive$ = defer(() => {
      const signal = this.context();
      const stored$ = this.eventStore.filters(this.filters);

      return this.decryptor
        .process$(stored$, this.autoUnlock, (error) => this.errors.next(error))
        .pipe(takeUntil(fromEvent(signal, "abort")));
    }).pipe(share());

    this.live$ = defer(() => {
      const signal = this.context();

      // The lookback is measured from when loading starts, not when the receiver was created.
      const since = unixNow() - (options.historySpan ?? 30 * 86400);
      const watches = this.mailboxes.map((mailbox) =>
        watchMailbox$(mailbox, since, this.mailboxDependencies, (error, relays) => {
          this.errors.next({ operation: "read", error, mailbox: mailbox.name, relays });
        }),
      );

      return merge(...watches).pipe(takeUntil(fromEvent(signal, "abort")));
    }).pipe(ignoreElements(), share());

    this.watch$ = defer(() => {
      const signal = this.context();
      const hydration$ = this.hydrate$(this.filters, signal).pipe(ignoreElements());

      return concat(hydration$, merge(this.receive$, this.live$)).pipe(takeUntil(fromEvent(signal, "abort")));
    }).pipe(share());
  }

  /** The incoming and outgoing account filters */
  get filters(): Filter[] {
    return this.mailboxes.map((mailbox) => mailbox.filter);
  }

  /** Whether background processing may currently invoke the signer */
  get autoUnlockEnabled(): boolean {
    return this.autoUnlock.value;
  }

  private context(options: MessageOperationOptions = {}): AbortSignal {
    if (this.disposed) throw new Error("Legacy inbox receiver disposed");

    const signal = options.signal ? AbortSignal.any([options.signal, this.generation.signal]) : this.generation.signal;
    signal.throwIfAborted();

    return signal;
  }

  private hydrate$(filters: Filter[], signal: AbortSignal): Observable<NostrEvent> {
    return defer(() => {
      signal.throwIfAborted();
      const cacheRequest = this.options.cacheRequest;
      if (!cacheRequest) return EMPTY;

      return defer(() => makeCacheRequest(cacheRequest, filters)).pipe(
        timeout({ each: this.options.timeout ?? 4000 }),
        mapEventsToStore(this.eventStore),
        tap({ complete: () => this.cacheError.next(undefined) }),
        catchError((error) => {
          this.cacheError.next(error);
          this.errors.next({ operation: "cache", error });
          return EMPTY;
        }),
        takeUntil(fromEvent(signal, "abort")),
      );
    });
  }

  /**
   * Restores cached events, then starts live loading and stored-event processing until stopped
   * @throws if the receiver is disposed
   */
  async start(): Promise<void> {
    const signal = this.context();
    if (this.background) return;

    const background = (this.background = new Subscription());
    this.lifecycle.next("running");

    await lastValueFrom(this.hydrate$(this.filters, signal), { defaultValue: undefined });
    if (signal.aborted || background.closed) return;

    background.add(merge(this.receive$, this.live$).subscribe());
  }

  /** Stops background work and outstanding operations while allowing later restart */
  stop(): void {
    this.authentication.clear();
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;

    if (!this.disposed && this.lifecycle.value !== "idle") this.lifecycle.next("idle");
  }

  /** Permanently releases this receiver without disposing the shared store or pool */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.stop();
    this.lifecycle.next("disposed");
    this.lifecycle.complete();
    this.errors.complete();
  }

  /** Releases the receiver through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Enables or disables signer-backed processing of stored and arriving messages
   * @throws if the receiver is disposed
   */
  setAutoUnlock(enabled: boolean): void {
    this.context();
    this.autoUnlock.next(enabled);
  }

  /**
   * Decrypts one event, or every loaded account message without a previous failure
   * @throws if disposed, cancelled, or decrypting the supplied event fails
   */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const signal = this.context(options);

    if (event) await this.decryptor.unlock(event, signal);
    else await this.decryptor.unlockAll(this.eventStore.getByFilters(this.filters), signal);
  }

  /**
   * Decrypts one eligible loaded message and returns its outcome, or undefined when none remain
   * @throws if disposed or cancelled
   */
  readNext(options: MessageOperationOptions = {}): Promise<LegacyReadResult | undefined> {
    const signal = this.context(options);
    return this.decryptor.readNext(this.eventStore.getByFilters(this.filters), signal);
  }

  /**
   * Yields one loaded message outcome per pull without prefetching or waiting for future arrivals
   * @throws if disposed or cancelled
   */
  async *readInbox(options: MessageOperationOptions = {}): AsyncGenerator<LegacyReadResult, void, void> {
    while (true) {
      const result = await this.readNext(options);
      if (!result) return;

      yield result;
    }
  }

  /**
   * Retries one loaded account message after clearing its failure
   * @throws if disposed, cancelled, or the message is not loaded
   */
  retry(eventId: string, options: MessageOperationOptions = {}): Promise<LegacyReadResult> {
    const signal = this.context(options);
    const event = this.loadedEvent(eventId);
    if (!event) throw new Error("Message is not loaded");

    this.decryptor.clearFailure(eventId);
    return this.decryptor.readResult(event, signal);
  }

  /**
   * Retries a snapshot of failed loaded messages one per pull
   * @throws if disposed or cancelled
   */
  async *retryFailed(options: MessageOperationOptions = {}): AsyncGenerator<LegacyReadResult, void, void> {
    this.context(options);

    for (const eventId of this.decryptor.failedEventIds()) {
      if (!this.decryptor.failure(eventId) || !this.loadedEvent(eventId)) continue;

      yield await this.retry(eventId, options);
    }
  }

  private loadedEvent(eventId: string): NostrEvent | undefined {
    const event = this.eventStore.getEvent(eventId);
    if (!event || !this.decryptor.isOwnMessage(event)) return undefined;

    return event;
  }

  /** Reconciles the account history range while following mailbox relay changes by default */
  sync$(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const signal = this.context(options);
      const filters = historyFilters(this.mailboxes, options);
      const hydration$ = this.hydrate$(filters, signal).pipe(ignoreElements());
      const reconciliation$ = syncMailboxes$(this.mailboxes, filters, options.followRelays, this.mailboxDependencies);

      return concat(hydration$, reconciliation$).pipe(takeUntil(fromEvent(signal, "abort")));
    });
  }

  /** Loads a finite account history range and returns its final reconciliation status */
  loadHistory(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Promise<LegacyMessagesSyncStatus> {
    return lastValueFrom(this.sync$({ ...options, followRelays: false }));
  }

  /** The outstanding receiving authentication requests at this moment */
  get currentAuthRequests(): readonly MessageAuthRequest[] {
    return this.authentication.currentRequests;
  }

  /** Checks whether a receiving relay is waiting for authentication */
  hasAuthRequest(url: string): boolean {
    return this.authentication.hasRequest(url);
  }

  /**
   * Authenticates one pending receiving relay
   * @throws if disposed, no matching signer or request exists, or authentication fails
   */
  authenticate(url: string): Promise<void> {
    this.context();
    return this.authentication.authenticate(url);
  }

  /**
   * Authenticates a snapshot of pending receiving relays and returns individual outcomes
   * @throws if disposed or stop/dispose cancels the batch
   */
  authenticateAll(): Promise<MessageAuthenticationResult[]> {
    this.context();
    return this.authentication.authenticateAll();
  }
}
