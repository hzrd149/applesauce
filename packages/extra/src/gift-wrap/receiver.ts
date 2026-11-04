import { castUser } from "applesauce-common/casts";
import { getGiftWrapRumor, getGiftWrapSeal, isGiftWrapUnlocked } from "applesauce-common/helpers";
import { RumorStore } from "applesauce-core/event-store";
import {
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
import { mapEventsToStore, watchEventsUpdates } from "applesauce-core/observable";
import { makeCacheRequest } from "applesauce-loaders/helpers";
import { createSyncLoader, type SyncLoaderStatus } from "applesauce-loaders/loaders";
import {
  BehaviorSubject,
  EMPTY,
  Observable,
  Subject,
  Subscription,
  catchError,
  combineLatest,
  concat,
  defer,
  distinctUntilChanged,
  firstValueFrom,
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
  timeout,
} from "rxjs";
import { MessageAuthentication, withMessageAuth$ } from "../messages/common/authentication.js";
import { configured$, withFallback$ } from "../messages/common/helpers.js";
import type {
  GiftWrapDecryptionState,
  GiftWrapHistoryOptions,
  GiftWrapFailure,
  GiftWrapReadResult,
  GiftWrapOperationOptions,
  GiftWrapReceiverError,
  GiftWrapReceiverOptions,
} from "./types.js";

type Processing = {
  stage: GiftWrapFailure["stage"];
  readers: number;
  allowSigner: boolean;
  controller: AbortController;
  result: Promise<Rumor | undefined>;
};

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
  private readonly failures = new Map<string, GiftWrapFailure>();
  private readonly attempts = new Map<string, number>();
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
  private activeDecryptions = 0;
  private readonly decryptionWaiters = new Set<() => void>();
  private readonly completed = new Set<string>();
  private readonly reserved = new Set<string>();
  private readonly inboxFilter: Filter;
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
    this.decryptionConcurrency = options.decryptionConcurrency ?? 1;
    if (!Number.isSafeInteger(this.decryptionConcurrency) || this.decryptionConcurrency < 1)
      throw new Error("Invalid decryption concurrency");
    this.autoUnlock.next(options.autoUnlock ?? false);
    this.inboxFilter = { kinds: [kinds.GiftWrap], "#p": [this.pubkey] };

    this.authentication = new MessageAuthentication(this.pool, this.pubkey, options.signer, true);
    this.authOptions = this.authentication.configure({
      authTimeout: options.authTimeout ?? false,
      onAuthRequired: options.autoAuth
        ? async ({ url }) => {
            try {
              await this.authentication.authenticate(url);
            } catch (error) {
              this.report("read", error);
            }
          }
        : undefined,
    });
    this.authRequests$ = this.authentication.requests$;

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
    this.receive$ = defer(() => {
      const signal = this.context();
      return merge(this.results, this.storedProcessing$).pipe(takeUntil(fromEvent(signal, "abort")));
    }).pipe(share());

    this.watch$ = defer(() => {
      const signal = this.context();
      const since = Math.max(0, unixNow() - (options.historySpan ?? 30 * 86400));
      const live$ = this.relays$.pipe(
        switchMap((relays) =>
          merge(
            ...relays.map((relay) =>
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
              ),
            ),
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

  private changed() {
    this.activity.next(this.activity.value + 1);
  }

  private report(operation: GiftWrapReceiverError["operation"], error: unknown, eventId?: string) {
    const failure = { operation, error, eventId };
    if (!this.disposed) this.errors.next(failure);
    return failure;
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
        timeout({ each: this.options.timeout ?? 10000 }),
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
    switchMap(
      (allowSigner) =>
        new Observable<never>((subscriber) => {
          const controller = new AbortController();
          const visited = new Map<string, readonly (string | undefined)[]>();
          const plaintext = (event: NostrEvent) => {
            const seal = getGiftWrapSeal(event);
            return [getEncryptedContent(event), seal ? getEncryptedContent(seal) : undefined];
          };
          let running = false;
          let dirty = false;
          const drain = async () => {
            dirty = true;
            if (running) return;
            running = true;
            try {
              while (dirty && !controller.signal.aborted) {
                dirty = false;
                const events = this.eventStore.getByFilters(this.inboxFilter)[Symbol.iterator]();
                const worker = async () => {
                  for (const event of events) {
                    if (controller.signal.aborted) break;
                    if (visited.has(event.id) || this.completed.has(event.id)) continue;
                    visited.set(event.id, plaintext(event));
                    const failure = this.failures.get(event.id);
                    // External decryption can recover signer failures without retrying the signer.
                    if (
                      failure &&
                      !((failure.stage === "wrap" || failure.stage === "seal") && isGiftWrapUnlocked(event))
                    )
                      continue;
                    try {
                      await this.read(event, allowSigner && !failure, controller.signal);
                    } catch {
                      /* Per-envelope failures remain visible in decryptionState$. */
                    }
                  }
                };
                await Promise.all(
                  Array.from({ length: Math.min(this.decryptionConcurrency, this.options.maxQueued ?? 64) }, worker),
                );
              }
            } finally {
              running = false;
            }
          };
          const subscriptions = new Subscription();
          subscriptions.add(
            merge(this.eventStore.insert$, this.eventStore.update$).subscribe((event) => {
              if (event.kind !== kinds.GiftWrap || !event.tags.some((tag) => tag[0] === "p" && tag[1] === this.pubkey))
                return;
              const previous = visited.get(event.id);
              const current = plaintext(event);
              if (previous && previous.every((value, index) => value === current[index])) return;
              visited.delete(event.id);
              void drain();
            }),
          );
          subscriptions.add(
            this.eventStore.remove$.subscribe((event) => {
              visited.delete(event.id);
              this.failures.delete(event.id);
              this.completed.delete(event.id);
              this.attempts.delete(event.id);
              this.clearRetry(event.id);
              this.changed();
            }),
          );
          subscriptions.add(() => controller.abort());
          subscriber.add(subscriptions);
          void drain();
        }),
    ),
  );

  private async layer(event: NostrEvent, allowSigner: boolean, signal: AbortSignal): Promise<boolean> {
    signal.throwIfAborted();
    let work = this.layers.get(event.id);
    if (!work) {
      const result = this.processLayer(event, allowSigner, signal);
      work = { signal, allowSigner, result };
      this.layers.set(event.id, work);
      const release = () => this.layers.delete(event.id);
      void result.then(release, release);
    }

    try {
      const unlocked = await firstValueFrom(
        defer(() => work.result).pipe(
          timeout({ first: this.options.decryptionTimeout ?? 60000 }),
          takeUntil(fromEvent(signal, "abort")),
        ),
        { defaultValue: false },
      );
      signal.throwIfAborted();
      // A cache-only lookup may precede a reader that explicitly allows the signer.
      if (!unlocked && allowSigner && !work.allowSigner) return this.layer(event, allowSigner, signal);
      return unlocked;
    } catch (error) {
      signal.throwIfAborted();
      // Another envelope may still need a seal whose original reader was cancelled.
      if (work.signal.aborted) return this.layer(event, allowSigner, signal);
      throw error;
    }
  }

  private async processLayer(event: NostrEvent, allowSigner: boolean, signal: AbortSignal): Promise<boolean> {
    if (!isEncryptedContentUnlocked(event) && this.options.decryptionCache) {
      try {
        await firstValueFrom(
          defer(() => restoreEncryptedContent(event, this.options.decryptionCache!)).pipe(
            timeout({ first: this.options.timeout ?? 10000 }),
          ),
        );
      } catch (error) {
        this.report("cache", error, event.id);
      }
    }
    signal.throwIfAborted();
    if (isEncryptedContentUnlocked(event)) return true;
    if (!allowSigner) return false;
    const signer = this.options.signer;
    if (!signer?.nip44) throw new Error("A NIP-44 signer is required");

    await this.decrypt(async () => {
      signal.throwIfAborted();
      if (isEncryptedContentUnlocked(event)) return;
      if ((await signer.getPublicKey()) !== this.pubkey) throw new Error("Signer does not match receiver owner");
      signal.throwIfAborted();
      await unlockEncryptedContent(event, event.pubkey, signer);
    }, signal);
    // Persist each completed layer even if the caller abandoned the following layer.
    if (this.options.decryptionCache) {
      try {
        await firstValueFrom(
          defer(() => saveEncryptedContent(event, this.options.decryptionCache!)).pipe(
            timeout({ first: this.options.timeout ?? 10000 }),
          ),
        );
      } catch (error) {
        this.report("cache", error, event.id);
      }
    }
    return true;
  }

  private async process(event: NostrEvent, allowSigner: boolean, signal: AbortSignal) {
    let stage: GiftWrapFailure["stage"] = "envelope";
    let code: GiftWrapFailure["code"] = "invalid-envelope";
    const setStage = (next: GiftWrapFailure["stage"]) => {
      stage = next;
      const work = this.processing.get(event.id);
      if (work) work.stage = next;
    };
    this.attempts.set(event.id, (this.attempts.get(event.id) ?? 0) + 1);
    try {
      this.validate(event);
      setStage("wrap");
      code = "decryption-failed";
      if (!(await this.layer(event, allowSigner, signal))) return;
      signal.throwIfAborted();
      setStage("seal");
      code = "invalid-seal";
      const seal = getGiftWrapSeal(event);
      if (!seal) throw new Error("Invalid gift wrap seal");
      code = "decryption-failed";
      if (!(await this.layer(seal, allowSigner, signal))) return;
      signal.throwIfAborted();
      setStage("rumor");
      code = "invalid-rumor";
      const rumor = getGiftWrapRumor(event);
      if (!rumor) throw new Error("Invalid gift wrap rumor");
      notifyEventUpdate(event);
      setStage("storage");
      code = "storage-failed";
      await this.rumorStore.add(rumor);
      signal.throwIfAborted();
      this.completed.add(event.id);
      this.failures.delete(event.id);
      this.clearRetry(event.id);
      this.results.next({ status: "success", event, rumor });
      return rumor;
    } catch (error) {
      if (!signal.aborted && !this.disposed) {
        this.recordFailure(event, stage, code, error);
      }
      throw error;
    } finally {
      if (!this.disposed) this.changed();
    }
  }

  private clearRetry(eventId: string) {
    clearTimeout(this.retryTimers.get(eventId));
    this.retryTimers.delete(eventId);
  }

  private recordFailure(
    event: NostrEvent,
    stage: GiftWrapFailure["stage"],
    code: GiftWrapFailure["code"],
    cause: unknown,
  ): GiftWrapFailure {
    const eventId = event.id;
    let retry: GiftWrapFailure["retry"] = code.startsWith("invalid-") ? "never" : "manual";
    if (code === "decryption-failed" && cause instanceof Error) {
      if (cause.message === "A NIP-44 signer is required") code = "signer-unavailable";
      else if (cause.message === "Signer does not match receiver owner") code = "signer-mismatch";
    }
    if (code === "decryption-failed" && this.options.retryPolicy?.classify) {
      try {
        const classification = this.options.retryPolicy.classify(cause);
        code = classification.code;
        retry = code === "signer-rejected" ? "manual" : classification.retry;
      } catch {
        // A classifier failure must not terminate inbox processing or hide the original cause.
      }
    }
    if (code === "timeout" || code === "storage-failed") retry = "automatic";
    const attempts = this.attempts.get(eventId) ?? 1;
    if (retry === "automatic" && attempts >= (this.options.retryPolicy?.maxAttempts ?? 1)) retry = "manual";
    const failure: GiftWrapFailure = { eventId, stage, code, cause, attempts, retry };
    this.failures.set(eventId, failure);
    this.errors.next({ operation: stage === "storage" ? "storage" : "decrypt", error: cause, eventId, failure });
    this.results.next({ status: "failed", event, failure });
    this.clearRetry(eventId);
    if (retry === "automatic") {
      const delay = Math.min(
        (this.options.retryPolicy?.delay ?? 1000) * 2 ** (attempts - 1),
        this.options.retryPolicy?.maxDelay ?? 30000,
      );
      const generation = this.generation.signal;
      this.retryTimers.set(
        eventId,
        setTimeout(() => {
          this.retryTimers.delete(eventId);
          const pending = this.processing.get(eventId)?.result;
          // A timed-out signer must settle before another attempt can begin.
          void Promise.resolve(pending)
            .catch(() => undefined)
            .then(async () => {
              if (generation.aborted || this.failures.get(eventId) !== failure) return;
              if (!this.eventStore.getByFilters(this.inboxFilter).some((event) => event.id === eventId)) return;
              await this.retry(eventId);
            })
            .catch(() => {});
        }, delay),
      );
    }
    return failure;
  }

  private async read(event: NostrEvent, allowSigner: boolean, signal: AbortSignal): Promise<Rumor | undefined> {
    signal.throwIfAborted();
    if (this.completed.has(event.id)) return getGiftWrapRumor(event);
    let work = this.processing.get(event.id);
    // A new reader must wait for an abandoned uncancellable call before starting fresh work.
    if (work && (work.controller.signal.aborted || (allowSigner && !work.allowSigner))) {
      const abandoned = work.result;
      await firstValueFrom(
        defer(() => abandoned.catch(() => undefined)).pipe(
          timeout({ first: this.options.decryptionTimeout ?? 60000 }),
          takeUntil(fromEvent(signal, "abort")),
        ),
        { defaultValue: undefined },
      );
      signal.throwIfAborted();
      return this.read(event, allowSigner, signal);
    }
    if (!work) {
      if (this.processing.size >= (this.options.maxQueued ?? 64)) throw new Error("Processing capacity exceeded");
      const controller = new AbortController();
      work = { readers: 0, stage: "envelope", allowSigner, controller, result: Promise.resolve(undefined) };
      this.processing.set(event.id, work);
      work.result = Promise.resolve().then(() => this.process(event, allowSigner, controller.signal));
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
      const rumor = await firstValueFrom(
        defer(() => work.result).pipe(
          timeout({ first: this.options.decryptionTimeout ?? 60000 }),
          takeUntil(fromEvent(signal, "abort")),
        ),
        { defaultValue: undefined },
      );
      signal.throwIfAborted();
      return rumor;
    } catch (error) {
      if (
        !signal.aborted &&
        !this.disposed &&
        error instanceof Error &&
        error.name === "TimeoutError" &&
        work.readers === 1
      ) {
        this.recordFailure(event, work.stage, "timeout", error);
      }
      throw error;
    } finally {
      signal.removeEventListener("abort", release);
      release();
    }
  }

  /**
   * Decrypts and stores one envelope, or all loaded envelopes without prior failures
   * @throws if disposed, cancelled, or processing the explicitly supplied envelope fails
   */
  async unlock(event: NostrEvent, options?: GiftWrapOperationOptions): Promise<Rumor>;
  async unlock(event?: undefined, options?: GiftWrapOperationOptions): Promise<void>;
  async unlock(event?: NostrEvent, options: GiftWrapOperationOptions = {}): Promise<Rumor | void> {
    const signal = this.context(options);
    if (event) {
      try {
        this.validate(event);
      } catch (cause) {
        this.attempts.set(event.id, (this.attempts.get(event.id) ?? 0) + 1);
        this.recordFailure(event, "envelope", "invalid-envelope", cause);
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
    for (const event of this.eventStore.getByFilters(this.inboxFilter)) {
      if (
        this.completed.has(event.id) ||
        this.failures.has(event.id) ||
        this.reserved.has(event.id) ||
        this.processing.has(event.id)
      )
        continue;
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
              code: cause instanceof Error && cause.name === "TimeoutError" ? "timeout" : "decryption-failed",
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
    const event = this.eventStore.getByFilters(this.inboxFilter).find((event) => event.id === eventId);
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
    const eventIds = [...this.failures.keys()];
    for (const eventId of eventIds) {
      if (!this.failures.has(eventId)) continue;
      if (!this.eventStore.getByFilters(this.inboxFilter).some((event) => event.id === eventId)) continue;
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
   * Retains a subscription to the shared live stream without reconciling history
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

  /** Reconciles an envelope timestamp range with operation-local progress */
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
              this.relays$.pipe(map((relays) => (relays.length ? relays : undefined))),
              [],
              this.options.timeout ?? 10000,
            ).pipe(take(1))
          : this.relays$;
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
