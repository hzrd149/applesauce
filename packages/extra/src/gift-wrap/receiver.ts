import { castUser } from "applesauce-common/casts";
import { getGiftWrapRumor, getGiftWrapSeal, isGiftWrapUnlocked } from "applesauce-common/helpers";
import { RumorStore } from "applesauce-core/event-store";
import {
  compileFilter,
  getEncryptedContent,
  isEncryptedContentUnlocked,
  isHexKey,
  kinds,
  mergeRelaySets,
  notifyEventUpdate,
  restoreEncryptedContent,
  saveEncryptedContent,
  unlockEncryptedContent,
  unixNow,
  verifyEvent,
  type Filter,
  type NostrEvent,
  type Rumor,
} from "applesauce-core/helpers";
import {
  combineLatestByValue,
  mapEventsToStore,
  watchEventsUpdates,
  withImmediateValueOrDefault,
} from "applesauce-core/observable";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import { createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  Subscription,
  TimeoutError,
  catchError,
  combineLatest,
  concat,
  defer,
  defaultIfEmpty,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  fromEvent,
  ignoreElements,
  lastValueFrom,
  map,
  merge,
  share,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap,
} from "rxjs";
import { idleTimeout } from "../helpers/idle-timeout.js";
import { MessageAuthentication, type MessageAuthRequest, withMessageAuth$ } from "../messages/common/authentication.js";
import { configured$, withFallback$ } from "../messages/common/helpers.js";
import type {
  GiftWrapDecryptionState,
  GiftWrapHistoryOptions,
  GiftWrapFailure,
  GiftWrapReadResult,
  GiftWrapOperationOptions,
  GiftWrapReceiverError,
  GiftWrapReceiverOptions,
  GiftWrapProcessingRecord,
} from "./types.js";

type Processing = {
  stage: GiftWrapFailure["stage"];
  readers: number;
  allowSigner: boolean;
  controller: AbortController;
  result: Promise<Rumor | undefined>;
};

class SignerError extends Error {
  constructor(
    readonly code: "signer-unavailable" | "signer-mismatch",
    message: string,
  ) {
    super(message);
  }
}

const defaultRetry: Record<GiftWrapFailure["code"], GiftWrapFailure["retry"]> = {
  "invalid-envelope": "never",
  "invalid-seal": "never",
  "invalid-rumor": "never",
  "signer-unavailable": "manual",
  "signer-mismatch": "manual",
  "signer-rejected": "manual",
  "decryption-failed": "manual",
  timeout: "automatic",
  "storage-failed": "automatic",
  "persistence-failed": "automatic",
};

/** The most envelopes with tracked failures. Any relay can deliver envelopes that fail to
 *  process, so the failure set is bounded instead of growing with hostile traffic. */
const MAX_TRACKED_FAILURES = 1000;

// Bound a caller's wait without cancelling the underlying storage or signer operation.
function waitForOperation<T>(operation: Promise<T>, milliseconds: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new TimeoutError());
    }, milliseconds);

    // Keep rejection handling attached even if this reader has already left.
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Returns why a stored processing checkpoint can't be restored, or undefined when it is valid */
function checkpointProblem(record: GiftWrapProcessingRecord): string | undefined {
  if (typeof record !== "object" || record === null) return "Invalid gift wrap processing checkpoint";

  if (
    record.version !== 1 ||
    !isHexKey(record.eventId) ||
    !Number.isSafeInteger(record.attempts) ||
    record.attempts < 0
  )
    return "Invalid gift wrap processing checkpoint";

  if (
    !["processing", "failed", "completed"].includes(record.status) ||
    !["envelope", "wrap", "seal", "rumor", "storage", "checkpoint"].includes(record.stage)
  )
    return "Invalid gift wrap processing state";

  if (record.retryAt !== undefined && (!Number.isFinite(record.retryAt) || record.retryAt < 0))
    return "Invalid gift wrap retry time";

  const failure = record.failure;
  if (
    record.status === "failed" &&
    (!failure ||
      failure.eventId !== record.eventId ||
      !Object.hasOwn(defaultRetry, failure.code) ||
      failure.attempts !== record.attempts ||
      failure.stage !== record.stage ||
      typeof failure.message !== "string" ||
      !["never", "manual", "automatic"].includes(failure.retry))
  )
    return "Invalid gift wrap failure checkpoint";

  if (record.status === "completed" && !isHexKey(record.rumorId ?? "")) return "Missing completed rumor ID";

  return undefined;
}

/** An account-scoped NIP-59 inbox with bounded decryption and independent authentication */
export class GiftWrapReceiver {
  /** The immutable recipient pubkey */
  readonly pubkey;
  /** The application-owned encrypted envelope store */
  readonly eventStore;
  /** The application-owned relay pool */
  readonly pool;
  /** The validated rumor destination, isolated from the encrypted envelope store */
  readonly rumorStore;
  /** The selected normalized inbox relays */
  readonly relays$: Observable<string[]>;
  /** The selected inbox relays plus the additive transport relays */
  readonly readRelays$: Observable<string[]>;
  /** The loaded account envelopes, including plaintext updates */
  readonly giftWraps$: Observable<NostrEvent[]>;
  /** The validated rumors in the destination store */
  readonly rumors$: Observable<Rumor[]>;
  /** The processing counts and failures for loaded envelopes */
  readonly decryptionState$: Observable<GiftWrapDecryptionState>;
  /** The outstanding authentication requirements shared by loading operations */
  readonly authRequests$;
  /** The shared store processing outcomes, active only while subscribed and without relay loading */
  readonly receive$: Observable<GiftWrapReadResult>;
  /** The shared live loading and processing stream, active only while subscribed */
  readonly watch$: Observable<GiftWrapReadResult>;

  private readonly lifecycle = new BehaviorSubject<"idle" | "running" | "disposed">("idle");
  /** The explicit start/stop ownership, independent of history or decryption success */
  readonly lifecycle$ = this.lifecycle.asObservable();
  private readonly autoUnlock = new BehaviorSubject(false);
  /** Whether background processing may invoke the decryption signer */
  readonly autoUnlock$ = this.autoUnlock.asObservable();
  private readonly errors = new Subject<GiftWrapReceiverError>();
  /** The contextual background loading, cache and storage failures */
  readonly errors$ = this.errors.asObservable();
  private readonly activity = new BehaviorSubject(0);
  private readonly results = new Subject<GiftWrapReadResult>();
  private failures = new Map<string, GiftWrapFailure>();
  private attempts = new Map<string, number>();
  private readonly retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly processing = new Map<string, Processing>();
  private readonly layers = new Map<
    string,
    {
      signal: AbortSignal;
      allowSigner: boolean;
      result: Promise<boolean>;
    }
  >();
  private readonly authentication;
  private readonly authOptions;
  private readonly decryptionConcurrency: number;
  private readonly processingConcurrency: number;
  private readonly inboxSubscriptions = new Subscription();
  private pendingInbox?: Set<string>;
  private activeDecryptions = 0;
  private readonly decryptionWaiters = new Set<() => void>();
  private completed = new Map<string, string>();
  private storedRumors = new Map<string, string>();
  private retryDue = new Map<string, number>();
  private readonly checkpointWrites = new Map<string, Promise<void>>();
  private restoration?: Promise<void>;
  private retryGeneration?: AbortSignal;
  private readonly reserved = new Set<string>();
  private readonly inboxFilter: Filter;
  private readonly matchesInbox: (event: NostrEvent) => boolean;
  private generation = new AbortController();
  private background?: Subscription;
  private disposed = false;

  /**
   * Creates a stopped receiver with manual authentication and opt-in decryption
   * @throws if the pubkey, processing capacity, or decryption concurrency is invalid
   */
  constructor(private readonly options: GiftWrapReceiverOptions) {
    if (!isHexKey(options.pubkey)) throw new Error("Invalid receiver pubkey");

    const capacity = options.maxQueued ?? 64;
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("Invalid processing capacity");

    const retryPolicy = options.retryPolicy;
    if (
      retryPolicy?.maxAttempts !== undefined &&
      (!Number.isSafeInteger(retryPolicy.maxAttempts) || retryPolicy.maxAttempts < 1)
    )
      throw new Error("Invalid retry attempt limit");
    for (const delay of [retryPolicy?.delay, retryPolicy?.maxDelay]) {
      if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) throw new Error("Invalid retry delay");
    }

    this.pubkey = options.pubkey;
    this.eventStore = options.eventStore;
    this.pool = options.pool;
    this.rumorStore = options.rumorStore ?? new RumorStore();

    this.decryptionConcurrency = options.decryptionConcurrency ?? 4;
    if (!Number.isSafeInteger(this.decryptionConcurrency) || this.decryptionConcurrency < 1)
      throw new Error("Invalid decryption concurrency");
    this.processingConcurrency = options.processingConcurrency ?? this.decryptionConcurrency;
    if (!Number.isSafeInteger(this.processingConcurrency) || this.processingConcurrency < 1)
      throw new Error("Invalid processing concurrency");
    this.autoUnlock.next(options.autoUnlock ?? false);
    // Snapshot constraints so later caller mutations cannot diverge from the compiled matcher.
    const constraints: Filter = Object.fromEntries(
      Object.entries(options.filter ?? {}).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
    );
    delete constraints.since;
    delete constraints.until;
    delete constraints.search;
    delete constraints.limit;
    this.inboxFilter = { ...constraints, kinds: [kinds.GiftWrap], "#p": [this.pubkey] };
    this.matchesInbox = compileFilter(this.inboxFilter);

    this.authentication = new MessageAuthentication(this.pool, this.pubkey, options.signer, true);
    this.authOptions = this.authentication.configure({
      authTimeout: options.authTimeout ?? false,
      onAuthRequired: async (context) => {
        await options.onAuthRequired?.(context);
        if (options.autoAuth) {
          try {
            await this.authentication.authenticate(context.url);
          } catch (error) {
            this.report("read", error);
          }
        }
      },
    });
    this.authRequests$ = this.authentication.requests$;

    // Prefer explicitly configured relays, then advertised inboxes, then the fallback.
    const advertised$ = castUser(this.pubkey, this.eventStore).directMessageRelays$.pipe(startWith(undefined));
    this.relays$ = (
      options.relays !== undefined
        ? configured$(options.relays, [])
        : combineLatest([advertised$, configured$(options.fallbackRelays, [])]).pipe(
            map(([advertised, fallback]) => (advertised?.length ? advertised : fallback)),
          )
    ).pipe(
      map((relays) => mergeRelaySets(relays).sort()),
      distinctUntilChanged((previous, next) => previous.join() === next.join()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.readRelays$ = combineLatest([
      this.relays$,
      // Optional discovery must not delay reading the selected inbox.
      configured$(options.extraRelays, []).pipe(defaultIfEmpty([]), withImmediateValueOrDefault([])),
    ]).pipe(
      map(([relays, extra]) => mergeRelaySets(relays, extra).sort()),
      distinctUntilChanged((previous, next) => previous.join() === next.join()),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    this.giftWraps$ = this.eventStore.timeline(this.inboxFilter).pipe(watchEventsUpdates(this.eventStore));
    this.rumors$ = this.rumorStore.timeline({});

    this.decryptionState$ = combineLatest([this.giftWraps$, this.activity]).pipe(
      map(([events]) => {
        const unlocked = events.filter(isGiftWrapUnlocked).length;
        return {
          total: events.length,
          unlocked,
          locked: events.length - unlocked,
          pending: events.filter((event) => (this.processing.get(event.id)?.readers ?? 0) > 0).length,
          errors: new Map(
            events.flatMap((event) => {
              const failure = this.failures.get(event.id);
              return failure ? [[event.id, failure] as const] : [];
            }),
          ),
        };
      }),
    );
    // Sharing keeps one store processor alive for all receiving and watching consumers.
    this.receive$ = defer(() => {
      const signal = this.context();
      const receiving$ = merge(this.results, this.storedProcessing$);
      if (!this.options.processingStore) return receiving$.pipe(takeUntil(fromEvent(signal, "abort")));

      // Restore once before attaching the shared processor, including existing store entries.
      return defer(() => this.ready()).pipe(
        switchMap(() => receiving$),
        takeUntil(fromEvent(signal, "abort")),
      );
    }).pipe(share());

    this.watch$ = defer(() => {
      const signal = this.context();
      const since = Math.max(0, unixNow() - (options.historySpan ?? 30 * 86400));
      const live$ = this.readRelays$.pipe(
        // Keep unchanged relay subscriptions and their authentication state alive.
        combineLatestByValue((relay) =>
          withMessageAuth$(this.authOptions, (auth) =>
            this.pool.subscription(
              [relay],
              { ...this.inboxFilter, since },
              { eventStore: this.eventStore, reconnect: true, ...auth },
            ),
          ).pipe(
            mapEventsToStore(this.eventStore),
            catchError((error) => {
              this.report("read", error);
              return EMPTY;
            }),
            ignoreElements(),
          ),
        ),
      );
      return merge(
        this.receive$,
        this.hydrate$(this.inboxFilter, signal).pipe(ignoreElements()),
        live$.pipe(ignoreElements()),
      ).pipe(takeUntil(fromEvent(signal, "abort")));
    }).pipe(share());
  }

  private context(options: GiftWrapOperationOptions = {}): AbortSignal {
    if (this.disposed) throw new Error("Gift wrap receiver disposed");
    const signal = options.signal ? AbortSignal.any([options.signal, this.generation.signal]) : this.generation.signal;
    signal.throwIfAborted();
    return signal;
  }

  /**
   * Restores processing checkpoints before receiving or explicitly processing envelopes
   * @throws if disposed, stopped, restoration times out, or checkpoint storage cannot be read
   */
  async ready(): Promise<void> {
    const signal = this.context();

    // Share restoration across concurrent callers, but allow a failed read to be retried.
    if (!this.restoration) {
      this.restoration = this.restore().catch((error) => {
        this.restoration = undefined;
        this.report("persistence", error);
        throw error;
      });
    }

    await waitForOperation(this.restoration, this.options.timeout ?? 10000, signal);
    signal.throwIfAborted();

    if (this.retryGeneration !== this.generation.signal) {
      this.retryGeneration = this.generation.signal;
      this.resumeRetries();
    }
  }

  private async restore() {
    if (!this.options.processingStore) return;
    const records = await this.options.processingStore.list();
    const attempts = new Map<string, number>();
    const storedRumors = new Map<string, string>();
    const completed = new Map<string, string>();
    const failures = new Map<string, GiftWrapFailure>();
    const retryDue = new Map<string, number>();

    // Consume database pages without retaining their records, then publish the validated snapshot atomically.
    for await (const record of records) {
      // A failed read is transient and fails the restore so it can be retried, but an invalid row
      // would fail every retry. Skip it so the rest of the snapshot restores; its envelope is then
      // processed again as if it had never been checkpointed.
      const problem = checkpointProblem(record);
      if (problem) {
        const eventId =
          typeof record === "object" && record !== null && isHexKey(record.eventId) ? record.eventId : undefined;
        this.report("persistence", new Error(problem), eventId);
        continue;
      }

      attempts.set(record.eventId, record.attempts);
      if (record.rumorId && record.status !== "completed") storedRumors.set(record.eventId, record.rumorId);
      if (record.status === "completed") completed.set(record.eventId, record.rumorId!);

      if (record.status === "failed" && record.failure) {
        const { message, ...details } = record.failure;
        const failure = { ...details, cause: new Error(message) };
        if (failure.retry === "automatic" && record.attempts >= (this.options.retryPolicy?.maxAttempts ?? 1))
          failure.retry = "manual";

        failures.set(record.eventId, failure);
        if (record.retryAt !== undefined) retryDue.set(record.eventId, record.retryAt);
      }
    }

    this.attempts = attempts;
    this.storedRumors = storedRumors;
    this.completed = completed;
    this.failures = failures;
    this.retryDue = retryDue;
    this.changed();
  }

  private async checkpoint(record: GiftWrapProcessingRecord): Promise<void> {
    const processingStore = this.options.processingStore;
    if (!processingStore) return;

    const previousWrite = this.checkpointWrites.get(record.eventId) ?? Promise.resolve();
    const pendingWrite = previousWrite
      .catch(() => {
        // The previous caller reports its failure; it must not block a newer checkpoint.
      })
      .then(() => processingStore.set(record));
    this.checkpointWrites.set(record.eventId, pendingWrite);

    const releaseWrite = () => {
      if (this.checkpointWrites.get(record.eventId) === pendingWrite) this.checkpointWrites.delete(record.eventId);
    };

    // A caller timeout does not release ordering until the underlying write settles.
    void pendingWrite.then(releaseWrite, releaseWrite);
    await waitForOperation(pendingWrite, this.options.timeout ?? 10000);
  }

  private resumeRetries() {
    for (const failure of this.failures.values()) {
      if (failure.retry !== "automatic" || this.retryTimers.has(failure.eventId)) continue;
      if (this.processing.has(failure.eventId) || this.reserved.has(failure.eventId)) continue;
      if (!this.eventStore.getEvent(failure.eventId)) continue;
      this.scheduleRetry(failure);
    }
  }

  private changed() {
    this.activity.next(this.activity.value + 1);
  }

  private report(operation: GiftWrapReceiverError["operation"], error: unknown, eventId?: string) {
    const failure = { operation, error, eventId };
    if (!this.disposed) this.errors.next(failure);
    return failure;
  }

  private inboxEvent(eventId: string): NostrEvent | undefined {
    const event = this.eventStore.getEvent(eventId);
    return event && this.matchesInbox(event) ? event : undefined;
  }

  private candidates(): Set<string> {
    if (this.pendingInbox) return this.pendingInbox;

    // Track only IDs; pulls do not repeatedly scan the completed history or retain evicted events.
    const candidates = (this.pendingInbox = new Set<string>());
    const include = (event: NostrEvent) => {
      if (this.inboxEvent(event.id) && !this.completed.has(event.id) && !this.failures.has(event.id))
        candidates.add(event.id);
    };
    this.inboxSubscriptions.add(this.eventStore.insert$.subscribe(include));
    this.inboxSubscriptions.add(this.eventStore.remove$.subscribe((event) => candidates.delete(event.id)));
    for (const event of this.eventStore.getByFilters(this.inboxFilter)) include(event);
    return candidates;
  }

  private validate(event: NostrEvent) {
    const recipients = event.tags.filter((tag) => tag[0] === "p");
    if (event.kind !== kinds.GiftWrap || recipients.length !== 1 || recipients[0][1] !== this.pubkey)
      throw new Error("Gift wrap is not addressed to this account");
    if (!verifyEvent(event)) throw new Error("Invalid gift wrap signature");
  }

  /**
   * Validates and stores an externally received envelope without prompting the signer
   * @throws if disposed, the envelope is invalid or foreign, or the store rejects it
   */
  async ingest(event: NostrEvent): Promise<NostrEvent> {
    this.context();
    this.validate(event);
    const stored = this.eventStore.add(event);
    if (!stored) throw new Error("Gift wrap was not retained by the event store");
    return stored;
  }

  private hydrate$(filter: Filter, signal: AbortSignal) {
    return defer(() => {
      signal.throwIfAborted();
      if (!this.options.cacheRequest) return EMPTY;
      return makeCacheRequest(this.options.cacheRequest, [filter]).pipe(
        idleTimeout(this.options.timeout ?? 10000),
        mapEventsToStore(this.eventStore),
        catchError((error) => {
          this.report("cache", error);
          return EMPTY;
        }),
        takeUntil(fromEvent(signal, "abort")),
      );
    });
  }

  // Scan stored envelopes on demand instead of buffering every arrival behind a signer prompt.
  private readonly storedProcessing$ = this.autoUnlock.pipe(
    distinctUntilChanged(),
    switchMap((allowSigner) =>
      defer(() => {
        const controller = new AbortController();
        const visited = new Map<string, readonly (string | undefined)[]>();
        const candidates = new Set(this.eventStore.getByFilters(this.inboxFilter).map((event) => event.id));
        const arrivals = new Set<string>();
        let preferArrival = true;
        const plaintext = (event: NostrEvent) => {
          const seal = getGiftWrapSeal(event);
          return [getEncryptedContent(event), seal ? getEncryptedContent(seal) : undefined];
        };

        let dirty = false;
        const drain = async () => {
          this.resumeRetries();
          while (dirty && !controller.signal.aborted) {
            dirty = false;
            const events = candidates.values();
            let processed = 0;
            const worker = async () => {
              while (true) {
                if (controller.signal.aborted) break;
                // Alternate a bounded live-arrival lane with the backlog so neither can starve.
                const eventId = preferArrival && arrivals.size ? arrivals.values().next().value : events.next().value;
                if (!eventId) break;
                preferArrival = !preferArrival;
                const event = this.inboxEvent(eventId);
                if (!event) {
                  candidates.delete(eventId);
                  arrivals.delete(eventId);
                  continue;
                }
                if (!this.processing.has(event.id) && this.processing.size >= (this.options.maxQueued ?? 64)) break;
                candidates.delete(eventId);
                arrivals.delete(eventId);
                if (visited.has(event.id)) continue;

                visited.set(event.id, plaintext(event));

                try {
                  const checkedLayers = await this.restoreCachedPlaintext(event, controller.signal);

                  const failure = this.failures.get(event.id);
                  // Cached or external plaintext can recover signer failures without retrying the signer.
                  const recovered =
                    failure && (failure.stage === "wrap" || failure.stage === "seal") && isGiftWrapUnlocked(event);
                  if (!this.completed.has(event.id) && (!failure || recovered))
                    await this.read(event, allowSigner && !failure, controller.signal, checkedLayers);

                  if (this.completed.has(event.id) && isGiftWrapUnlocked(event)) visited.delete(event.id);
                } catch (error) {
                  // Expected envelope failures are already published by process().
                  if (!controller.signal.aborted && !this.failures.has(event.id)) {
                    this.report("decrypt", error, event.id);
                  }
                }

                // Cached backlogs can otherwise monopolize the microtask queue indefinitely.
                if (++processed % 64 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
              }
            };
            await Promise.all(
              Array.from({ length: Math.min(this.processingConcurrency, this.options.maxQueued ?? 64) }, worker),
            );
          }
        };

        const arrivals$ = merge(this.eventStore.insert$, this.eventStore.update$).pipe(
          filter((event) => (!this.completed.has(event.id) || !isGiftWrapUnlocked(event)) && this.matchesInbox(event)),
          filter((event) => {
            const previous = visited.get(event.id);
            const current = plaintext(event);
            return !previous || !previous.every((value, index) => value === current[index]);
          }),
          tap((event) => {
            visited.delete(event.id);
            candidates.add(event.id);
            if (arrivals.size < (this.options.maxQueued ?? 64)) arrivals.add(event.id);
          }),
        );

        const removals$ = this.eventStore.remove$.pipe(
          tap((event) => {
            visited.delete(event.id);
            candidates.delete(event.id);
            arrivals.delete(event.id);
            // Memory eviction does not erase durable processing progress.
            this.clearRetry(event.id);
            this.changed();
          }),
        );

        // Coalesce arrivals while draining; the dirty flag preserves one trailing scan.
        // Activity also wakes envelopes that were waiting for processing capacity.
        return merge(arrivals$, removals$, this.activity).pipe(
          tap(() => {
            dirty = true;
          }),
          exhaustMap(() => drain()),
          ignoreElements(),
          finalize(() => controller.abort()),
        );
      }),
    ),
  );

  private async restoreCachedPlaintext(event: NostrEvent, signal: AbortSignal): Promise<Set<string>> {
    const checkedLayers = new Set<string>();
    if (isGiftWrapUnlocked(event)) return checkedLayers;

    // Plaintext availability is independent of durable processing progress.
    // Remember misses too, so subsequent processing does not repeat these cache reads.
    checkedLayers.add(event.id);
    if (!(await this.layer(event, false, signal))) return checkedLayers;
    const seal = getGiftWrapSeal(event);
    if (!seal) return checkedLayers;
    checkedLayers.add(seal.id);
    if (!(await this.layer(seal, false, signal))) return checkedLayers;

    // Seal updates do not notify subscribers to the outer envelope.
    if (getGiftWrapRumor(event)) notifyEventUpdate(event);
    return checkedLayers;
  }

  private async layer(
    event: NostrEvent,
    allowSigner: boolean,
    signal: AbortSignal,
    restoreCache = true,
  ): Promise<boolean> {
    signal.throwIfAborted();

    // Readers share each layer, including seals referenced by more than one envelope.
    let work = this.layers.get(event.id);
    if (!work) {
      const result = this.processLayer(event, allowSigner, signal, restoreCache);
      work = { signal, allowSigner, result };
      this.layers.set(event.id, work);
      const release = () => this.layers.delete(event.id);
      void result.then(release, release);
    }

    try {
      const unlocked = await waitForOperation(work.result, this.options.decryptionTimeout ?? 60000, signal);
      signal.throwIfAborted();

      // A cache-only lookup may precede a reader that explicitly allows the signer.
      if (!unlocked && allowSigner && !work.allowSigner) return this.layer(event, allowSigner, signal, restoreCache);
      return unlocked;
    } catch (error) {
      signal.throwIfAborted();
      // Another envelope may still need a seal whose original reader was cancelled.
      if (work.signal.aborted) return this.layer(event, allowSigner, signal, restoreCache);
      throw error;
    }
  }

  private async processLayer(
    event: NostrEvent,
    allowSigner: boolean,
    signal: AbortSignal,
    restoreCache: boolean,
  ): Promise<boolean> {
    // A cache hit can unlock a layer without asking the signer for permission.
    if (restoreCache && !isEncryptedContentUnlocked(event) && this.options.decryptionCache) {
      try {
        await waitForOperation(
          restoreEncryptedContent(event, this.options.decryptionCache),
          this.options.timeout ?? 10000,
        );
      } catch (error) {
        this.report("cache", error, event.id);
      }
    }

    signal.throwIfAborted();
    if (isEncryptedContentUnlocked(event)) return true;
    if (!allowSigner) return false;

    const signer = this.options.signer;
    if (!signer?.nip44) throw new SignerError("signer-unavailable", "A NIP-44 signer is required");

    await this.decrypt(async () => {
      signal.throwIfAborted();
      if (isEncryptedContentUnlocked(event)) return;

      if ((await signer.getPublicKey()) !== this.pubkey)
        throw new SignerError("signer-mismatch", "Signer does not match receiver owner");

      signal.throwIfAborted();
      await unlockEncryptedContent(event, event.pubkey, signer);
    }, signal);

    // Persist each completed layer even if the caller abandoned the following layer.
    if (this.options.decryptionCache) {
      try {
        await waitForOperation(
          saveEncryptedContent(event, this.options.decryptionCache),
          this.options.timeout ?? 10000,
        );
      } catch (error) {
        this.report("cache", error, event.id);
      }
    }

    return true;
  }

  private async process(
    event: NostrEvent,
    allowSigner: boolean,
    signal: AbortSignal,
    checkedLayers?: ReadonlySet<string>,
  ) {
    let stage: GiftWrapFailure["stage"] = "envelope";
    let code: GiftWrapFailure["code"] = "invalid-envelope";
    const setStage = (next: GiftWrapFailure["stage"]) => {
      stage = next;
      const work = this.processing.get(event.id);
      if (work) work.stage = next;
    };
    let attemptStarted = false;

    // Cache-only misses do not spend an attempt or write a processing checkpoint.
    const beginAttempt = async () => {
      if (attemptStarted) return;
      attemptStarted = true;

      const attempts = (this.attempts.get(event.id) ?? 0) + 1;
      this.attempts.set(event.id, attempts);

      await this.checkpoint({
        version: 1,
        eventId: event.id,
        status: "processing",
        stage: "wrap",
        attempts,
        rumorId: this.storedRumors.get(event.id),
      });
    };
    const saveProgress = async (nextStage: GiftWrapFailure["stage"]) => {
      if (!attemptStarted) return;

      setStage("checkpoint");
      code = "persistence-failed";

      await this.checkpoint({
        version: 1,
        eventId: event.id,
        status: "processing",
        stage: nextStage,
        attempts: this.attempts.get(event.id)!,
        rumorId: this.storedRumors.get(event.id),
      });
      signal.throwIfAborted();
    };

    try {
      setStage("checkpoint");
      code = "persistence-failed";
      if (allowSigner) await beginAttempt();
      signal.throwIfAborted();

      // A previous attempt may have stored the rumor but failed to save completion.
      const storedRumorId = this.storedRumors.get(event.id);
      const storedRumor = storedRumorId ? await this.rumorStore.getEvent(storedRumorId) : undefined;
      if (storedRumor) {
        await beginAttempt();
        await this.complete(event, storedRumor, signal);
        return storedRumor;
      }

      setStage("envelope");
      code = "invalid-envelope";
      this.validate(event);

      // Open the outer envelope before inspecting the signed seal inside it.
      setStage("wrap");
      code = "decryption-failed";
      if (!(await this.layer(event, allowSigner, signal, !checkedLayers?.has(event.id)))) return;
      signal.throwIfAborted();

      await saveProgress("seal");
      setStage("seal");
      code = "invalid-seal";
      const seal = getGiftWrapSeal(event);
      if (!seal) throw new Error("Invalid gift wrap seal");

      code = "decryption-failed";
      if (!(await this.layer(seal, allowSigner, signal, !checkedLayers?.has(seal.id)))) return;
      signal.throwIfAborted();

      // Only validated plaintext reaches the separate rumor store.
      setStage("rumor");
      code = "invalid-rumor";
      const rumor = getGiftWrapRumor(event);
      if (!rumor) throw new Error("Invalid gift wrap rumor");
      notifyEventUpdate(event);

      setStage("checkpoint");
      code = "persistence-failed";
      await beginAttempt();
      signal.throwIfAborted();
      await saveProgress("storage");

      setStage("storage");
      code = "storage-failed";
      await this.rumorStore.add(rumor);
      this.storedRumors.set(event.id, rumor.id);
      signal.throwIfAborted();

      setStage("checkpoint");
      code = "persistence-failed";
      await this.complete(event, rumor, signal);
      return rumor;
    } catch (error) {
      if (!signal.aborted && !this.disposed) {
        if (!attemptStarted) this.attempts.set(event.id, (this.attempts.get(event.id) ?? 0) + 1);
        await this.recordFailure(event, stage, code, error);
      }
      throw error;
    } finally {
      if (!this.disposed) this.changed();
    }
  }

  private async complete(event: NostrEvent, rumor: Rumor, signal: AbortSignal) {
    // Success is observable only after both rumor storage and its checkpoint have settled.
    await this.checkpoint({
      version: 1,
      eventId: event.id,
      status: "completed",
      stage: "checkpoint",
      attempts: this.attempts.get(event.id) ?? 0,
      rumorId: rumor.id,
    });
    signal.throwIfAborted();

    this.completed.set(event.id, rumor.id);
    this.storedRumors.delete(event.id);
    this.pendingInbox?.delete(event.id);
    this.failures.delete(event.id);
    this.retryDue.delete(event.id);
    this.clearRetry(event.id);
    this.results.next({ status: "success", event, rumor });
  }

  private clearRetry(eventId: string) {
    clearTimeout(this.retryTimers.get(eventId));
    this.retryTimers.delete(eventId);
  }

  private async recordFailure(
    event: NostrEvent,
    stage: GiftWrapFailure["stage"],
    code: GiftWrapFailure["code"],
    cause: unknown,
  ): Promise<GiftWrapFailure> {
    const generation = this.generation.signal;
    const eventId = event.id;
    if (cause instanceof SignerError) code = cause.code;
    else if (cause instanceof TimeoutError && code !== "persistence-failed") code = "timeout";

    let retry = defaultRetry[code];
    if (code === "decryption-failed" && this.options.retryPolicy?.classify) {
      try {
        const classification = this.options.retryPolicy.classify(cause);
        code = classification.code;
        retry = code === "signer-rejected" ? "manual" : classification.retry;
      } catch {
        // A classifier failure must not terminate inbox processing or hide the original cause.
      }
    }

    const attempts = this.attempts.get(eventId) ?? 1;
    if (retry === "automatic" && attempts >= (this.options.retryPolicy?.maxAttempts ?? 1)) retry = "manual";

    const failure: GiftWrapFailure = { eventId, stage, code, cause, attempts, retry };

    // Any relay can deliver envelopes addressed to the user that fail processing, so the failure
    // set is bounded. Hostile floods only produce never-retry failures (an attacker cannot build
    // an envelope that decrypts, so its failures are structural), and those are never retried —
    // so they are evicted first. Retryable failures (the ones a user may be waiting on) are only
    // evicted once the entire set is retryable.
    while (this.failures.size >= MAX_TRACKED_FAILURES && !this.failures.has(eventId)) {
      let victim: string | undefined;
      for (const [id, tracked] of this.failures) {
        if (tracked.retry === "never") {
          victim = id;
          break;
        }
      }
      victim ??= this.failures.keys().next().value;
      if (victim === undefined) break;
      this.failures.delete(victim);
      this.attempts.delete(victim);
      this.retryDue.delete(victim);
    }
    this.failures.set(eventId, failure);

    const retryAt = retry === "automatic" ? Date.now() + this.retryDelay(attempts) : undefined;
    if (retryAt !== undefined) this.retryDue.set(eventId, retryAt);
    else this.retryDue.delete(eventId);

    try {
      const { cause: _, ...details } = failure;
      await this.checkpoint({
        version: 1,
        eventId,
        status: "failed",
        stage,
        attempts,
        retryAt,
        rumorId: this.storedRumors.get(eventId),
        failure: { ...details, message: cause instanceof Error ? cause.message : String(cause) },
      });
    } catch (error) {
      this.report("persistence", error, eventId);
    }

    // A newer attempt or stop may have superseded this failure while its write was pending.
    if (this.disposed || generation.aborted || this.failures.get(eventId) !== failure) return failure;

    let operation: GiftWrapReceiverError["operation"] = "decrypt";
    if (stage === "checkpoint") operation = "persistence";
    else if (stage === "storage") operation = "storage";

    this.errors.next({
      operation,
      error: cause,
      eventId,
      failure,
    });
    this.results.next({ status: "failed", event, failure });

    this.clearRetry(eventId);
    if (retry === "automatic") this.scheduleRetry(failure);

    return failure;
  }

  private retryDelay(attempts: number) {
    return Math.min(
      (this.options.retryPolicy?.delay ?? 1000) * 2 ** (attempts - 1),
      this.options.retryPolicy?.maxDelay ?? 30000,
    );
  }

  private scheduleRetry(failure: GiftWrapFailure): void {
    const { eventId, attempts } = failure;
    const retryAt = this.retryDue.get(eventId) ?? Date.now() + this.retryDelay(attempts);
    this.retryDue.set(eventId, retryAt);

    // Long backoffs are rechecked when the largest supported timer interval expires.
    const delay = Math.min(2_147_483_647, Math.max(0, retryAt - Date.now()));
    const generation = this.generation.signal;
    this.retryTimers.set(
      eventId,
      setTimeout(() => {
        this.retryTimers.delete(eventId);
        void this.runRetry(failure, generation).catch((error) => {
          if (!generation.aborted) this.report("decrypt", error, eventId);
        });
      }, delay),
    );
  }

  private async runRetry(failure: GiftWrapFailure, signal: AbortSignal): Promise<void> {
    const { eventId } = failure;

    // Wait for the previous attempt to settle; its failure has already been reported.
    await this.processing.get(eventId)?.result.catch(() => undefined);

    if (signal.aborted || this.failures.get(eventId) !== failure) return;
    if (!this.inboxEvent(eventId)) return;
    if ((this.retryDue.get(eventId) ?? 0) > Date.now()) {
      this.scheduleRetry(failure);
      return;
    }

    await this.retry(eventId, { signal });
  }

  private async read(
    event: NostrEvent,
    allowSigner: boolean,
    signal: AbortSignal,
    checkedLayers?: ReadonlySet<string>,
  ): Promise<Rumor | undefined> {
    signal.throwIfAborted();
    const rumorId = this.completed.get(event.id);
    if (rumorId) {
      const rumor = await this.rumorStore.getEvent(rumorId);
      if (rumor) {
        await this.restoreCachedPlaintext(event, signal);
        return rumor;
      }
      // An application may prune its rumor store; explicitly unlocking repairs the record.
      this.completed.delete(event.id);
      this.storedRumors.delete(event.id);
    }

    let work = this.processing.get(event.id);

    // A new reader must wait for an abandoned uncancellable call before starting fresh work.
    if (work && (work.controller.signal.aborted || (allowSigner && !work.allowSigner))) {
      const abandoned = work.result;
      await waitForOperation(
        abandoned.catch(() => undefined),
        this.options.decryptionTimeout ?? 60000,
        signal,
      );
      signal.throwIfAborted();
      return this.read(event, allowSigner, signal, checkedLayers);
    }

    if (!work) {
      if (this.processing.size >= (this.options.maxQueued ?? 64)) throw new Error("Processing capacity exceeded");

      const controller = new AbortController();
      work = { readers: 0, stage: "envelope", allowSigner, controller, result: Promise.resolve(undefined) };
      this.processing.set(event.id, work);
      work.result = Promise.resolve().then(() => this.process(event, allowSigner, controller.signal, checkedLayers));
      const release = () => {
        this.processing.delete(event.id);
        if (!this.disposed) this.changed();
      };
      void work.result.then(release, release);
    }

    work.readers++;
    this.changed();

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      work.readers--;
      if (!work.readers) work.controller.abort();
      if (!this.disposed) this.changed();
    };

    // Release demand synchronously so a replacement cache-only watcher cannot retain signer permission.
    signal.addEventListener("abort", release, { once: true });

    try {
      const rumor = await waitForOperation(work.result, this.options.decryptionTimeout ?? 60000, signal);
      signal.throwIfAborted();
      return rumor;
    } catch (error) {
      if (!signal.aborted && !this.disposed && error instanceof TimeoutError && work.readers === 1) {
        release();
        await this.recordFailure(event, work.stage, "timeout", error);
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", release);
      release();
    }
  }

  /**
   * Decrypts and stores one envelope and returns its validated rumor
   * @throws if disposed, cancelled, or processing the explicitly supplied envelope fails
   */
  async unlock(event: NostrEvent, options?: GiftWrapOperationOptions): Promise<Rumor>;
  /**
   * Decrypts and stores all loaded envelopes without prior failures
   * @throws if disposed or cancelled
   */
  async unlock(event?: undefined, options?: GiftWrapOperationOptions): Promise<void>;
  /**
   * Decrypts and stores the supplied envelope or all eligible loaded envelopes
   * @throws if disposed, cancelled, or processing the supplied envelope fails
   */
  async unlock(event?: NostrEvent, options: GiftWrapOperationOptions = {}): Promise<Rumor | void> {
    const signal = this.context(options);
    await this.ready();
    signal.throwIfAborted();
    if (event) {
      try {
        this.validate(event);
      } catch (cause) {
        this.attempts.set(event.id, (this.attempts.get(event.id) ?? 0) + 1);
        await this.recordFailure(event, "envelope", "invalid-envelope", cause);
        this.changed();
        throw cause;
      }
      const stored = await this.ingest(event);
      // Cache-only processing may already own this envelope; follow it with an explicit unlock.
      const rumor = await this.read(stored, true, signal);
      if (rumor) return rumor;
      signal.throwIfAborted();
      const retried = await this.read(stored, true, signal);
      if (!retried) throw new Error("Gift wrap processing ended without a rumor");
      return retried;
    }
    const envelopes = this.eventStore.getByFilters(this.inboxFilter)[Symbol.iterator]();
    const worker = async () => {
      for (const envelope of envelopes) {
        signal.throwIfAborted();
        if (this.failures.has(envelope.id)) continue;
        try {
          await this.unlock(envelope, { signal });
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(this.decryptionConcurrency, this.options.maxQueued ?? 64) }, worker),
    );
  }

  /**
   * Processes one eligible loaded envelope and returns its outcome, or undefined when none remain
   * @throws if disposed or cancelled
   */
  async readNext(options: GiftWrapOperationOptions = {}): Promise<GiftWrapReadResult | undefined> {
    const signal = this.context(options);
    await this.ready();
    signal.throwIfAborted();
    for (const eventId of this.candidates()) {
      const event = this.inboxEvent(eventId);
      if (!event || this.completed.has(eventId) || this.failures.has(eventId)) {
        this.pendingInbox!.delete(eventId);
        continue;
      }
      if (this.reserved.has(event.id) || this.processing.has(event.id)) continue;
      this.reserved.add(event.id);
      try {
        return await this.readResult(event, signal);
      } finally {
        this.reserved.delete(event.id);
      }
    }
    return undefined;
  }

  private async readResult(event: NostrEvent, signal: AbortSignal): Promise<GiftWrapReadResult> {
    try {
      const rumor = await this.unlock(event, { signal });
      return { status: "success", event, rumor };
    } catch (cause) {
      signal.throwIfAborted();
      const work = this.processing.get(event.id);
      const recorded = this.failures.get(event.id);
      const failure =
        recorded && recorded.cause === cause
          ? recorded
          : ({
              eventId: event.id,
              stage: work?.stage ?? "envelope",
              code: cause instanceof TimeoutError ? "timeout" : "decryption-failed",
              cause,
              attempts: this.attempts.get(event.id) ?? 1,
              retry: "manual",
            } satisfies GiftWrapFailure);
      return { status: "failed", event, failure };
    }
  }

  /**
   * Retries one loaded envelope using any already decrypted layers
   * @throws if disposed, cancelled, or the envelope is not loaded
   */
  async retry(eventId: string, options: GiftWrapOperationOptions = {}): Promise<GiftWrapReadResult> {
    const signal = this.context(options);
    await this.ready();
    signal.throwIfAborted();
    const event = this.inboxEvent(eventId);
    if (!event) throw new Error("Envelope is not loaded");
    this.clearRetry(eventId);
    return this.readResult(event, signal);
  }

  /**
   * Retries a snapshot of failed envelopes one per pull without prefetching
   * @throws if disposed or cancelled
   */
  async *retryFailed(options: GiftWrapOperationOptions = {}): AsyncGenerator<GiftWrapReadResult, void, void> {
    this.context(options);
    await this.ready();
    const eventIds = [...this.failures.keys()];
    for (const eventId of eventIds) {
      if (!this.failures.has(eventId)) continue;
      if (!this.inboxEvent(eventId)) continue;
      yield await this.retry(eventId, options);
    }
  }

  private async decrypt(operation: () => Promise<void>, signal: AbortSignal): Promise<void> {
    while (this.activeDecryptions >= this.decryptionConcurrency) {
      signal.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(signal.reason);
        };
        const cleanup = () => {
          this.decryptionWaiters.delete(wake);
          signal.removeEventListener("abort", abort);
        };
        this.decryptionWaiters.add(wake);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
    signal.throwIfAborted();
    this.activeDecryptions++;

    // Cancellation releases the reader, but only settlement releases the signer slot.
    try {
      await operation();
    } finally {
      this.activeDecryptions--;
      for (const wake of this.decryptionWaiters) wake();
    }
  }

  /**
   * Yields one loaded envelope outcome per pull without prefetching or waiting for future arrivals
   * @throws if disposed or cancelled
   */
  async *readInbox(options: GiftWrapOperationOptions = {}): AsyncGenerator<GiftWrapReadResult, void, void> {
    while (true) {
      const rumor = await this.readNext(options);
      if (!rumor) return;
      yield rumor;
    }
  }

  /**
   * Enables or disables signer-backed processing of stored and arriving envelopes
   * @throws if the receiver is disposed
   */
  setAutoUnlock(enabled: boolean): void {
    this.context();
    this.autoUnlock.next(enabled);
  }

  /**
   * Starts shared live loading and envelope processing until stopped
   * @throws if the receiver is disposed
   */
  async start(): Promise<void> {
    this.context();
    if (this.background) return;
    const background = (this.background = new Subscription());
    this.lifecycle.next("running");
    background.add(
      this.watch$.subscribe({
        error: (error) => {
          this.report("read", error);
          this.stop();
        },
      }),
    );
  }

  /** Stops current watches and operations while allowing later restart */
  stop(): void {
    for (const eventId of this.retryTimers.keys()) this.clearRetry(eventId);
    this.authentication.clear();
    this.generation.abort();
    this.generation = new AbortController();
    this.background?.unsubscribe();
    this.background = undefined;
    if (!this.disposed) this.lifecycle.next("idle");
  }

  /** Loads missing envelopes in a timestamp range and streams reconciliation progress */
  sync$(options: GiftWrapHistoryOptions = {}): Observable<SyncLoaderStatus> {
    return defer(() => {
      const signal = this.context(options);
      const filter: Filter = {
        ...this.inboxFilter,
        since: Math.max(0, options.since ?? 0),
        ...(options.until !== undefined ? { until: options.until } : {}),
      };
      const relays =
        options.followRelays === false
          ? withFallback$(
              this.readRelays$.pipe(map((relays) => (relays.length ? relays : undefined))),
              [],
              this.options.timeout ?? 10000,
            ).pipe(take(1))
          : this.readRelays$;
      const sync = createSyncLoader({ pool: this.pool, eventStore: this.eventStore });
      const reconciliation$ = withMessageAuth$(this.authOptions, (auth) => {
        const operation = sync({ filter, relays, ...auth });
        return merge(operation.events$.pipe(ignoreElements()), operation.status$);
      });
      return concat(this.hydrate$(filter, signal).pipe(ignoreElements()), reconciliation$).pipe(
        takeUntil(fromEvent(signal, "abort")),
      );
    });
  }

  /**
   * Loads a finite envelope range and returns its final reconciliation status
   * @throws if disposed, reconciliation fails, or cancellation ends the stream before any status
   */
  loadHistory(options: GiftWrapHistoryOptions = {}): Promise<SyncLoaderStatus> {
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
   * Authenticates one pending relay independently of decryption
   * @throws if disposed, no matching signer or request exists, authentication fails, or the attempt is cancelled
   */
  authenticate(url: string): Promise<void> {
    this.context();
    return this.authentication.authenticate(url);
  }

  /**
   * Authenticates a snapshot of pending relays and returns individual outcomes
   * @throws if disposed or stop/dispose cancels the batch
   */
  authenticateAll() {
    this.context();
    return this.authentication.authenticateAll();
  }

  /** Releases owned work and the default rumor store without disposing application dependencies */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.inboxSubscriptions.unsubscribe();
    this.pendingInbox?.clear();
    if (!this.options.rumorStore) this.rumorStore.dispose();
    this.lifecycle.next("disposed");
    this.lifecycle.complete();
    this.errors.complete();
    this.results.complete();
  }

  /** Releases the receiver through explicit resource management */
  [Symbol.dispose](): void {
    this.dispose();
  }
}
