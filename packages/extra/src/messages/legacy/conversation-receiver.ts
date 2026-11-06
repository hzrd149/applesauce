import type { EventStore } from "applesauce-core";
import { getLegacyMessageCorrespondent } from "applesauce-common/helpers";
import {
  restoreEncryptedContent,
  unixNow,
  type EncryptedContentCache,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import { mapEventsToStore, watchEventsUpdates } from "applesauce-core/observable";
import type { CacheRequest } from "applesauce-loaders";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import {
  createFilterMapTimelineLoader,
  type TimelineLoader,
  type TimelineLoaderOptions,
} from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import {
  BehaviorSubject,
  catchError,
  concat,
  defer,
  distinctUntilChanged,
  EMPTY,
  finalize,
  fromEvent,
  ignoreElements,
  lastValueFrom,
  map,
  merge,
  Observable,
  ReplaySubject,
  share,
  shareReplay,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  timeout,
} from "rxjs";
import { withMessageAuth$ } from "../common/authentication.js";
import type { MessageOperationOptions } from "../common/types.js";
import type { LegacyMessageDecryptor } from "./decryptor.js";
import {
  combineMailboxRelays$,
  createConversationMailboxes,
  historyFilters,
  mailboxRelayMap$,
  syncMailboxes$,
  watchMailbox$,
  type LegacyMailbox,
  type LegacyMailboxDependencies,
} from "./mailboxes.js";
import type {
  LegacyDecryptionState,
  LegacyMessageHistoryOptions,
  LegacyMessagesSyncStatus,
  LegacyReadResult,
  LegacyReceiverError,
} from "./types.js";

/** Dependencies for a NIP-04 conversation receiver */
export interface LegacyConversationReceiverOptions {
  /** The immutable owner pubkey */
  pubkey: string;
  /** The other participant, or the owner for self-messages */
  correspondent: string;
  /** The shared event store */
  eventStore: EventStore;
  /** The shared relay pool */
  pool: RelayPool;
  /** The account decryptor shared with the inbox receiver */
  decryptor: LegacyMessageDecryptor;
  /** The account's receiving authentication options */
  authOptions: LegacyMailboxDependencies["authOptions"];
  /** The encrypted kind-4 event cache */
  cacheRequest?: CacheRequest;
  /** The plaintext cache keyed by kind-4 event ID */
  decryptionCache?: EncryptedContentCache;
  /** The fallback relays used when no mailbox relays are advertised */
  fallbackRelays?: string[] | Observable<string[]>;
  /** Whether background processing may invoke the signer, default false */
  autoUnlock?: boolean;
  /** The relay discovery and cache timeout in milliseconds (default 4000) */
  timeout?: number;
  /** The live subscription lookback in seconds (default 30 days) */
  historySpan?: number;
}

/** A NIP-04 receiver for one conversation that reads from both participants' relays */
export class LegacyConversationReceiver {
  /** The other participant, or the owner for self-messages */
  readonly correspondent: string;
  /** The relays read for incoming and outgoing messages */
  readonly relays$: Observable<string[]>;
  /** The native incoming and outgoing kind-4 events in the shared store */
  readonly messages$: Observable<NostrEvent[]>;
  /** The newest in-memory or cached message, restoring cached plaintext without relay requests or signer prompts */
  readonly lastMessage$: Observable<NostrEvent | undefined>;
  /** The current decryption snapshot for loaded conversation messages */
  readonly decryptionState$: Observable<LegacyDecryptionState>;
  /** The shared live loading and stored-event processing stream, active only while subscribed */
  readonly watch$: Observable<LegacyReadResult>;
  /** The shared live mailbox subscriptions, opened on the first subscriber and closed after the last */
  private readonly live$: Observable<never>;

  private readonly lifecycle = new BehaviorSubject<"idle" | "running" | "disposed">("idle");
  /** The explicit start/stop lifecycle */
  readonly lifecycle$ = this.lifecycle.asObservable();
  private readonly autoUnlock: BehaviorSubject<boolean>;
  /** Whether background processing may invoke the signer */
  readonly autoUnlock$: Observable<boolean>;
  private readonly errors = new Subject<LegacyReceiverError>();
  /** The contextual loading, cache and decryption failures */
  readonly errors$ = this.errors.asObservable();

  private readonly mailboxes: LegacyMailbox[];
  private readonly mailboxDependencies: LegacyMailboxDependencies;
  private readonly destroyed = new ReplaySubject<void>(1);
  private background?: Subscription;
  private generation = new AbortController();
  private disposed = false;

  /** Creates a stopped conversation receiver */
  constructor(private readonly options: LegacyConversationReceiverOptions) {
    const { pubkey, correspondent, eventStore } = options;
    this.correspondent = correspondent;

    this.autoUnlock = new BehaviorSubject(options.autoUnlock ?? false);
    this.autoUnlock$ = this.autoUnlock.asObservable();

    this.mailboxes = createConversationMailboxes(pubkey, correspondent, eventStore, options.fallbackRelays);
    this.mailboxDependencies = {
      eventStore,
      pool: options.pool,
      authOptions: options.authOptions,
      fallbackRelays: options.fallbackRelays,
      timeout: this.timeout,
    };
    this.relays$ = combineMailboxRelays$(this.mailboxes);

    // Decryption updates cached content without replacing the stored event.
    this.messages$ = eventStore.timeline(this.filters).pipe(watchEventsUpdates(eventStore));
    this.decryptionState$ = options.decryptor.observeState$(this.messages$);
    this.lastMessage$ = defer(() => {
      const controller = new AbortController();
      const latest$ = this.messages$.pipe(map((messages) => messages[0]));

      const restore$ = latest$.pipe(
        distinctUntilChanged(),
        switchMap((event) => {
          const cache = this.options.decryptionCache;
          if (!event || !cache) return EMPTY;

          return defer(() => restoreEncryptedContent(event, cache)).pipe(
            timeout({ first: this.timeout }),
            catchError((error) => {
              this.errors.next({ operation: "cache", error, eventId: event.id });
              return EMPTY;
            }),
          );
        }),
        ignoreElements(),
      );

      // Read both directions independently so the cache returns each direction's newest event.
      const filters = this.filters.map((filter) => ({ ...filter, limit: 1 }));
      const hydration$ = this.hydrate$(filters, controller.signal).pipe(ignoreElements());

      return merge(latest$, restore$, hydration$).pipe(finalize(() => controller.abort()));
    }).pipe(takeUntil(this.destroyed), shareReplay({ bufferSize: 1, refCount: true }));

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
      const stored$ = eventStore.filters(this.filters);
      const processing$ = options.decryptor.process$(stored$, this.autoUnlock, (error) => this.errors.next(error));

      return merge(processing$, this.live$).pipe(takeUntil(fromEvent(signal, "abort")));
    }).pipe(share());
  }

  /** The incoming and outgoing conversation filters */
  get filters(): Filter[] {
    return this.mailboxes.map((mailbox) => mailbox.filter);
  }

  /** Whether this receiver has been permanently released */
  get isDisposed(): boolean {
    return this.disposed;
  }

  private get timeout() {
    return this.options.timeout ?? 4000;
  }

  private context(options: MessageOperationOptions = {}): AbortSignal {
    if (this.disposed) throw new Error("Conversation disposed");

    const signal = options.signal ? AbortSignal.any([options.signal, this.generation.signal]) : this.generation.signal;
    signal.throwIfAborted();

    return signal;
  }

  private hydrate$(filters: Filter[], signal: AbortSignal): Observable<NostrEvent> {
    return defer(() => {
      signal.throwIfAborted();
      const cacheRequest = this.options.cacheRequest;
      if (!cacheRequest) return EMPTY;

      return makeCacheRequest(cacheRequest, filters).pipe(
        timeout({ each: this.timeout }),
        mapEventsToStore(this.options.eventStore),
        catchError((error) => {
          this.errors.next({ operation: "cache", error });
          return EMPTY;
        }),
        takeUntil(fromEvent(signal, "abort")),
      );
    });
  }

  /**
   * Starts live loading and stored-event processing until stopped
   * @throws if the receiver is disposed
   */
  start(): void {
    this.context();
    if (this.background) return;

    this.background = new Subscription();
    this.lifecycle.next("running");
    this.background.add(this.watch$.subscribe());
  }

  /** Stops loading and outstanding operations while allowing later restart */
  stop(): void {
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;

    if (!this.disposed && this.lifecycle.value !== "idle") this.lifecycle.next("idle");
  }

  /** Permanently releases this receiver without disposing the shared store, pool or decryptor */
  dispose(): void {
    if (this.disposed) return;

    this.disposed = true;
    this.stop();
    this.destroyed.next();
    this.destroyed.complete();
    this.lifecycle.next("disposed");
    this.lifecycle.complete();
    this.errors.complete();
  }

  /** Releases the receiver through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }

  /** Enables or disables signer-backed processing for this conversation */
  setAutoUnlock(enabled: boolean): void {
    this.autoUnlock.next(enabled);
  }

  private belongsToConversation(event: NostrEvent) {
    return getLegacyMessageCorrespondent(event, this.options.pubkey) === this.correspondent;
  }

  /**
   * Decrypts one conversation event, or every loaded conversation message without a previous failure
   * @throws if disposed, cancelled, the event belongs to another conversation, or decrypting it fails
   */
  async unlock(event?: NostrEvent, options: MessageOperationOptions = {}): Promise<void> {
    const signal = this.context(options);
    const { decryptor, eventStore } = this.options;

    if (!event) return decryptor.unlockAll(eventStore.getByFilters(this.filters), signal);

    if (!this.belongsToConversation(event)) throw new Error("Message does not belong to this conversation");
    await decryptor.unlock(event, signal);
  }

  /**
   * Decrypts one eligible loaded conversation message and returns its outcome, or undefined when none remain
   * @throws if disposed or cancelled
   */
  readNext(options: MessageOperationOptions = {}): Promise<LegacyReadResult | undefined> {
    const signal = this.context(options);
    return this.options.decryptor.readNext(this.options.eventStore.getByFilters(this.filters), signal);
  }

  /**
   * Yields one loaded conversation message outcome per pull without waiting for future arrivals
   * @throws if disposed or cancelled
   */
  async *readMessages(options: MessageOperationOptions = {}): AsyncGenerator<LegacyReadResult, void, void> {
    while (true) {
      const result = await this.readNext(options);
      if (!result) return;

      yield result;
    }
  }

  /**
   * Retries one loaded conversation message after clearing its failure
   * @throws if disposed, cancelled, or the message is not loaded in this conversation
   */
  retry(eventId: string, options: MessageOperationOptions = {}): Promise<LegacyReadResult> {
    const signal = this.context(options);
    const event = this.options.eventStore.getEvent(eventId);
    if (!event || !this.belongsToConversation(event)) throw new Error("Message is not loaded");

    this.options.decryptor.clearFailure(eventId);
    return this.options.decryptor.readResult(event, signal);
  }

  /** Reconciles this conversation's history while following mailbox relay changes by default */
  sync$(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Observable<LegacyMessagesSyncStatus> {
    return defer(() => {
      const signal = this.context(options);
      const filters = historyFilters(this.mailboxes, options);
      const hydration$ = this.hydrate$(filters, signal).pipe(ignoreElements());
      const reconciliation$ = syncMailboxes$(this.mailboxes, filters, options.followRelays, this.mailboxDependencies);

      return concat(hydration$, reconciliation$).pipe(takeUntil(fromEvent(signal, "abort")));
    });
  }

  /** Loads a finite conversation history range */
  loadHistory(options: Omit<LegacyMessageHistoryOptions, "correspondent"> = {}): Promise<LegacyMessagesSyncStatus> {
    return lastValueFrom(this.sync$({ ...options, followRelays: false }));
  }

  /**
   * Creates an independent viewport loader whose subscriptions stop with this receiver
   * @throws if the receiver is disposed or timeline options are invalid
   */
  createTimelineLoader(options: Omit<TimelineLoaderOptions, "eventStore" | "cache"> = {}): TimelineLoader {
    this.context();
    const { pool, authOptions, eventStore, cacheRequest } = this.options;

    const request = (relays: string[], filters: Parameters<RelayPool["request"]>[1]) =>
      withMessageAuth$(authOptions, (auth) => pool.request(relays, filters, auth));

    const loader = createFilterMapTimelineLoader(request, mailboxRelayMap$(this.mailboxes), {
      ...options,
      eventStore,
      cache: cacheRequest,
      cacheFilters: this.filters,
    });

    const load = (windows: Parameters<TimelineLoader>[0]) =>
      defer(() => {
        const signal = this.context();
        return loader(windows).pipe(takeUntil(fromEvent(signal, "abort")));
      }).pipe(share());

    return Object.assign(load, { status$: loader.status$ });
  }
}
