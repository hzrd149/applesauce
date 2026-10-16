import { logger as baseLogger, type Debugger } from "applesauce-core";
import { chainable, type ChainableObservable } from "applesauce-core/observable";
import {
  asyncScheduler,
  catchError,
  combineLatest,
  concat,
  defaultIfEmpty,
  defer,
  distinctUntilChanged,
  EMPTY,
  expand,
  filter,
  finalize,
  from,
  map,
  merge,
  NEVER,
  Observable,
  of,
  ReplaySubject,
  share,
  Subject,
  switchMap,
  takeUntil,
  tap,
  timeout,
  timer,
  type SchedulerLike,
} from "rxjs";
import { createCountRuntime, type CountRuntime, type CountRuntimeOptions } from "./count-runtime.js";
import { createPersistentCountCache } from "../helpers/count-service/cache.js";
import { createTransportScheduler } from "../helpers/count-service/scheduler.js";
import { fallbackCountSource } from "./count-sources/fallback.js";
import { nip85CountSource, type Nip85CountSourceOptions } from "./count-sources/nip85.js";
import { routingCountSource } from "./count-sources/routing.js";
import { relayCountSource } from "./count-sources/relay.js";
import type {
  AssertionRequest,
  CountList,
  CountMetric,
  CountPool,
  CountQuery,
  CountRequest,
  CountResult,
  CountSource,
  CountTarget,
  CountUpstream,
} from "./count-sources/types.js";

/** The state of one independently observed metric */
export interface CountState {
  /** The selected count, or undefined when unavailable */
  value: number | undefined;

  /** Whether the retained value is still fresh */
  fresh: boolean;

  /** Whether a resolution is underway */
  refreshing: boolean;

  /** The successful source provenance */
  origin: CountResult["origin"] | undefined;

  /** Whether the selected source supplied an approximation */
  approximate: boolean | undefined;

  /** The fetch time in milliseconds */
  observedAt: number | undefined;

  /** The assertion creation time in seconds */
  assertedAt: number | undefined;

  /** The last failed resolution */
  failure: unknown | undefined;
}

/** A bounded snapshot of service-owned work and retention */
export interface CountDiagnostic {
  /** The activity or lifecycle notification */
  type: string;

  /** The active transport count */
  active: number;

  /** The pending transport count */
  pending: number;

  /** The retained result and cooldown cache entries */
  cacheEntries: number;

  /** The canonical observed metric entries */
  activeMetrics: number;

  /** The measured duration in milliseconds for timing diagnostics */
  latency?: number;
}

/** A Keyv-compatible persistent store dedicated to count cache records and invalidation markers */
export interface CountCache {
  /** Gets a stored record or invalidation marker */
  get(key: string): Promise<unknown>;
  /** Stores a value with a relative lifetime in milliseconds, where zero disables expiry */
  set(key: string, value: CountCacheRecord | string, ttl?: number): Promise<unknown>;
}

/** A versioned successful count with absolute expiry deadlines */
export interface CountCacheRecord {
  /** The serialization format version */
  version: 1;
  /** The effective source policy */
  policy: string;
  /** The successful count state */
  state: CountState;
  /** The absolute freshness deadline, or null for unlimited freshness */
  freshUntil: number | null;
  /** The absolute retention deadline, or null for unlimited retention */
  retainUntil: number | null;
}

/** Options for demand-driven event metric counts */
export interface CountServiceOptions {
  /** The explicit routing tree, overriding the legacy source hierarchy */
  source?: CountSource;

  /** The shared transport runtime for explicit routing trees */
  runtime?: CountRuntime;

  /** The optional capacity settings for a service-owned routing runtime */
  capacity?: Omit<CountRuntimeOptions, "scheduler">;

  /** The capacity selection wait in milliseconds, default 1000 */
  selectionTimeout?: number;

  /** The explicit ordered hierarchy, overriding automatic source creation */
  sources?: readonly CountSource[];

  /** The optional Keyv-compatible persistent count cache; use a dedicated namespace */
  cache?: CountCache;

  /** The persistent retention lifetime in milliseconds, default 24 hours */
  cacheRetention?: number;

  /** The maximum cache operation duration in milliseconds, default 1000 */
  cacheTimeout?: number;

  /** The structural upstream pool used by automatic sources */
  pool?: CountPool;

  /** The explicit COUNT method, overriding pool.count */
  count?: CountRequest;

  /** The explicit finite assertion request method, overriding pool.request */
  request?: AssertionRequest;

  /** The ordered trusted relays for automatic NIP-45 counts */
  relays?: CountList<string>;

  /** The metric-scoped providers for automatic NIP-85 counts before relay fallback */
  providers?: Nip85CountSourceOptions["providers"];

  /** The freshness curve receiving event age in seconds and returning milliseconds, defaulting to 1 minute through 6 hours */
  ttl?: (context: { age: number; query: CountQuery }) => number;

  /** The maximum inactive cached result and cooldown entries, default 1000 */
  cacheCapacity?: number;

  /** The global transport limit, default 8 */
  concurrency?: number;

  /** The transport limit per relay, default 2 */
  perRelay?: number;

  /** The transport limit per provider, default 2 */
  perProvider?: number;

  /** The maximum queued transports, default 256 */
  queueCapacity?: number;

  /** The transport admission window in milliseconds, default 0 (next scheduler turn) */
  admissionWindow?: number;

  /** The entire resolution deadline in milliseconds, default 15000 */
  resolutionTimeout?: number;

  /** The individual source deadline in milliseconds, default 5000 */
  attemptTimeout?: number;

  /** The minimum refresh interval in milliseconds, default 1000 */
  minimumRefresh?: number;

  /** The failed resolution retry interval in milliseconds, default 10000 */
  retryDelay?: number;

  /** The clock for deadlines and deterministic tests */
  scheduler?: SchedulerLike;

  /** The deterministic random source for retry jitter */
  random?: () => number;

  /** The optional service cancellation signal */
  signal?: AbortSignal;

  /** The parent logger for the service and its source attempts */
  logger?: Debugger;

  /** The optional transport instrumentation callback */
  diagnostic?: (event: CountDiagnostic) => void;
}

/** A handle whose metrics load independently */
export interface EventCountHandle {
  /** The reaction count state */
  reactions: ChainableObservable<CountState>;

  /** The reaction count shortcut */
  reactions$: Observable<number | undefined>;

  /** The comment count state */
  comments: ChainableObservable<CountState>;

  /** The comment count shortcut */
  comments$: Observable<number | undefined>;

  /** Returns the state for an explicit semantic metric */
  metric(metric: CountMetric): ChainableObservable<CountState>;
}

/** A shared service for independently observed event metrics */
export interface CountService {
  /** Creates a lazy event metric handle */
  event(target: CountTarget): EventCountHandle;

  /**
   * Invalidates retained results immediately and resolves after persistent invalidation completes
   * @throws if persistent invalidation fails or times out
   */
  invalidate(target?: CountTarget): Promise<void>;

  /** Cancels all active work and prevents future loading */
  stop(): void;
}

/** The canonical kind-7 event reaction count */
export const reactionCountMetric: CountMetric = {
  id: "reactions:v1",
  unit: "events",
  assertionTag: "reaction_cnt",
  filters: (target) => (target.address ? undefined : [{ kinds: [7], "#e": [target.id] }]),
};

/** The legacy kind-1 reference count, including indirect thread references */
export const legacyReferenceCountMetric: CountMetric = {
  id: "legacy-references:v1",
  unit: "events",
  filters: (target) => (target.address ? undefined : [{ kinds: [1], "#e": [target.id] }]),
};

/** The NIP-22 root comment count, including the entire comment tree */
export const rootCommentCountMetric: CountMetric = {
  id: "root-comments:v1",
  unit: "events",
  assertionTag: "comment_cnt",
  filters: (target) =>
    target.address ? [{ kinds: [1111], "#A": [target.address] }] : [{ kinds: [1111], "#E": [target.id] }],
};

function defaultCountTTL(age: number): number {
  if (age < 6 * 60 * 60) return 60_000;
  if (age < 24 * 60 * 60) return 5 * 60_000;
  if (age < 7 * 24 * 60 * 60) return 30 * 60_000;
  if (age < 30 * 24 * 60 * 60) return 2 * 60 * 60_000;
  return 6 * 60 * 60_000;
}

/**
 * Creates a lazy shared count service with ordered sources and age-based freshness
 * @throws if configured sources lack transports, limits are invalid, or source IDs are duplicated
 */
export function createCountService(options: CountServiceOptions): CountService;

/**
 * Creates a count service from a request method or structural pool and routing options
 * @throws if configured sources lack transports or limits are invalid
 */
export function createCountService(upstream: CountUpstream, options: CountServiceOptions): CountService;
export function createCountService(
  input: CountServiceOptions | CountUpstream,
  configuration?: CountServiceOptions,
): CountService {
  const options: CountServiceOptions =
    configuration === undefined
      ? (input as CountServiceOptions)
      : { ...configuration, pool: typeof input === "function" ? { request: input } : (input as CountPool) };

  const log = (options.logger ?? baseLogger).extend("count-service");
  const sourceLog = log.extend("sources");
  const transportLog = log.extend("transport");

  // Explicit composition wins; automatic sources try assertions before relay counts.
  const sources = options.source
    ? [options.source]
    : (options.sources ?? [
        ...(options.providers
          ? [nip85CountSource({ pool: options.pool, request: options.request, providers: options.providers })]
          : []),
        ...(options.relays
          ? [relayCountSource({ pool: options.pool, count: options.count, relays: options.relays })]
          : []),
      ]);

  const positive = (name: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);

    return value;
  };

  const clock = options.scheduler ?? options.runtime?.scheduler ?? asyncScheduler;
  if (options.runtime && options.scheduler && options.runtime.scheduler !== options.scheduler)
    throw new Error("Count service and runtime must use the same scheduler");
  const runtime =
    options.runtime ?? (options.source ? createCountRuntime({ ...options.capacity, scheduler: clock }) : undefined);
  const minimum = positive("minimumRefresh", options.minimumRefresh ?? 1000);
  const retry = positive("retryDelay", options.retryDelay ?? 10000);
  const deadline = positive("resolutionTimeout", options.resolutionTimeout ?? 15000);
  const attempt = positive("attemptTimeout", options.attemptTimeout ?? 5000);
  const cacheTimeout = positive("cacheTimeout", options.cacheTimeout ?? 1000);
  if (options.cacheRetention !== undefined && options.cacheRetention !== Infinity)
    positive("cacheRetention", options.cacheRetention);
  const persistent = options.cache && createPersistentCountCache(options.cache, clock, cacheTimeout);
  const capacity = options.cacheCapacity ?? 1000;
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error("cacheCapacity must be a nonnegative integer");

  const limit = (name: string, value: number) => {
    positive(name, value);
    if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`);

    return value;
  };

  let activity = { active: 0, pending: 0 };
  const diagnostic = (type: string, latency?: number) =>
    options.diagnostic?.({ type, latency, ...activity, cacheEntries: cache.size, activeMetrics: registry.size });

  const admissionWindow = options.admissionWindow ?? 0;
  if (!Number.isFinite(admissionWindow) || admissionWindow < 0)
    throw new Error("admissionWindow must be nonnegative and finite");

  // All sources share admission limits, including nested fallbacks and retries.
  const transport =
    runtime ??
    createTransportScheduler({
      admissionWindow,
      clock,
      logger: transportLog,
      concurrency: limit("concurrency", options.concurrency ?? 8),
      perRelay: limit("perRelay", options.perRelay ?? 2),
      perProvider: limit("perProvider", options.perProvider ?? 2),
      queueCapacity: limit("queueCapacity", options.queueCapacity ?? 256),
      diagnostic: (event) => {
        activity = { active: event.active, pending: event.pending };
        options.diagnostic?.({ ...event, cacheEntries: cache.size, activeMetrics: registry.size });
      },
    });

  const resolver = options.source ? routingCountSource("fallback", [options.source]) : fallbackCountSource(sources);
  const batchScope = {};
  const selectionTimeout = positive("selectionTimeout", options.selectionTimeout ?? 1000);
  const stopped$ = new ReplaySubject<void>(1);
  const invalidated$ = new Subject<string | undefined>();
  let stopped = false;

  // Retain values and cooldowns separately from the registry of currently observed streams.
  const cache = new Map<
    string,
    {
      policy: string;
      state: CountState;
      retryAt?: number;
      freshUntil?: number | null;
      write?: (record: CountCacheRecord) => Promise<void>;
    }
  >();
  const registry = new Map<string, Observable<CountState>>();

  const targetKey = (target: CountTarget) => (target.address ? `a:${target.address}` : `e:${target.id}`);
  const keyFor = (query: CountQuery) => JSON.stringify([targetKey(query.target), query.metric.id]);

  // Only inactive entries are evictable; observed metrics remain pinned.
  const trim = () => {
    let inactive = [...cache.keys()].filter((key) => !registry.has(key));
    while (inactive.length > capacity) cache.delete(inactive.shift()!);
  };

  // Reevaluate target age on observation and refresh, with a floor that prevents tight loops.
  const ttl = (query: CountQuery) => {
    const age = Number.isFinite(query.target.created_at)
      ? Math.max(0, clock.now() / 1000 - query.target.created_at)
      : 0;
    const value = options.ttl?.({ age, query }) ?? defaultCountTTL(age);

    return value === Infinity ? Infinity : Math.max(minimum, Number.isFinite(value) ? value : minimum);
  };

  // Resolve the canonical stream on subscription so old handles rejoin after registry eviction.
  const stateFor = (query: CountQuery): Observable<CountState> =>
    defer(() => {
      if (stopped) return EMPTY;

      const key = keyFor(query);
      let canonical = registry.get(key);
      if (!canonical) {
        log("Metric activated", key);

        const began = clock.now();
        let firstValue = false;

        // Keep policy observation alive independently of each finite source attempt.
        const policy$ = sources.length
          ? combineLatest(
              sources.map((source) =>
                defer(() => source.policy(query)).pipe(
                  timeout({
                    first: attempt,
                    scheduler: clock,

                    // Allow a bounded initial wait, then continue observing configuration that arrives later.
                    with: () => {
                      log("Policy wait expired", key, source.id, "timeout", attempt);
                      return concat(of("waiting"), source.policy(query));
                    },
                  }),

                  catchError((error) => {
                    log("Policy failed", key, source.id, error);
                    return concat(of("unavailable"), NEVER);
                  }),
                ),
              ),
            ).pipe(
              map((value) => JSON.stringify(value.map((policy, index) => [sources[index].id, policy]))),
              distinctUntilChanged(),
            )
          : of("[]");

        canonical = policy$.pipe(
          tap(() => log("Policy observed", key)),
          // A policy revision cancels obsolete work before resolving against the new trust/routing rules.
          switchMap((policy) =>
            // Start once, then restart only for invalidations affecting this target.
            merge(
              of(undefined),
              invalidated$.pipe(filter((target) => target === undefined || target === targetKey(query.target))),
            ).pipe(
              switchMap(() => {
                const memory = cache.get(key);
                const load =
                  memory?.policy === policy && memory.write
                    ? of({ record: undefined, write: memory.write })
                    : persistent
                      ? from(persistent.read(targetKey(query.target), query.metric.id, policy)).pipe(
                          catchError((error) => {
                            log("Cache read failed", key, error);
                            return of(undefined);
                          }),
                        )
                      : of(undefined);
                return load.pipe(
                  switchMap((stored) => {
                    const record = stored?.record as CountCacheRecord | undefined;
                    if (
                      (!cache.has(key) || cache.get(key)?.policy !== policy) &&
                      record &&
                      record.version === 1 &&
                      record.policy === policy &&
                      record.state &&
                      Number.isSafeInteger(record.state.value) &&
                      record.state.value! >= 0 &&
                      Number.isFinite(record.state.observedAt) &&
                      record.state.observedAt! <= clock.now() &&
                      record.state.failure === undefined &&
                      record.state.origin &&
                      typeof record.state.origin.adapter === "string" &&
                      typeof record.state.origin.relay === "string" &&
                      (record.freshUntil === null || Number.isFinite(record.freshUntil)) &&
                      (record.retainUntil === null ||
                        (Number.isFinite(record.retainUntil) && record.retainUntil > clock.now()))
                    ) {
                      cache.set(key, {
                        policy,
                        state: record.state,
                        freshUntil: record.freshUntil,
                        write: stored?.write,
                      });
                      diagnostic("persistent-cache-hit");
                    }
                    let retained = cache.get(key);

                    // Reject cached acceptance from an old policy before exposing any retained value.
                    if (retained?.policy !== policy) {
                      if (retained) log("Cached policy revoked", key);
                      cache.delete(key);
                      retained = undefined;
                    }

                    // Touch retained entries to preserve insertion order for inactive eviction.
                    if (retained) {
                      cache.delete(key);
                      cache.set(key, retained);
                    }

                    const old = retained?.state;
                    const fresh =
                      !old?.failure &&
                      old?.observedAt !== undefined &&
                      clock.now() - old.observedAt < ttl(query) &&
                      (retained?.freshUntil === undefined ||
                        retained.freshUntil === null ||
                        clock.now() < retained.freshUntil);
                    const coolingDown = retained?.retryAt !== undefined && retained.retryAt > clock.now();
                    let retryAt = retained?.retryAt;
                    diagnostic(fresh ? "cache-hit" : "cache-miss");
                    log("Cache %s", fresh ? "hit" : "miss", key, "cooldown", coolingDown);

                    // Expose retained data immediately; freshness and retry cooldown decide whether to fetch now.
                    const initial: CountState = old
                      ? { ...old, fresh, refreshing: !fresh && !coolingDown }
                      : {
                          value: undefined,
                          fresh: false,
                          refreshing: true,
                          origin: undefined,
                          approximate: undefined,
                          observedAt: undefined,
                          assertedAt: undefined,
                          failure: undefined,
                        };

                    let failures = old?.failure ? 1 : 0;

                    // Back off failed resolutions with bounded jitter instead of retrying each revisit immediately.
                    const retryInterval = () => {
                      const random = (options.random ?? Math.random)();
                      const jitter = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5;

                      return (
                        Math.min(60000, retry * 2 ** Math.min(5, Math.max(0, failures - 1))) * (0.8 + 0.4 * jitter)
                      );
                    };

                    // Each resolution settles once; failures preserve the previous successful value and provenance.
                    const resolve = (previous: CountState): Observable<CountState> =>
                      defer(() => {
                        let failure: unknown = new Error("No count source answered");
                        log("Resolution started", key, "timeout", deadline);

                        return resolver
                          .count(query, {
                            deadline: clock.now() + deadline,
                            runtime,
                            attempts: new Set(),
                            routed: !!options.source,
                            batchScope,
                            selectionTimeout,
                            transport,
                            clock,
                            attemptTimeout: attempt,
                            logger: sourceLog,
                            diagnostic,
                            onFailure: (error) => {
                              failure = error;
                              log("Source attempt failed", key, error);
                            },
                          })
                          .pipe(
                            // Bound the entire hierarchy, including queue time and individual source attempts.
                            timeout({ first: deadline, scheduler: clock }),
                            map((result): CountState => ({
                              value: result.value,
                              origin: result.origin,
                              approximate: result.approximate,
                              assertedAt: result.assertedAt,
                              failure: undefined,
                              fresh: true,
                              refreshing: false,
                              observedAt: clock.now(),
                            })),

                            catchError((error) => {
                              failure = error;
                              log("Resolution failed", key, error);

                              return EMPTY;
                            }),

                            // Empty completion is a missing result, never a fabricated count of zero.
                            defaultIfEmpty(undefined),
                            map((state) => state ?? { ...previous, fresh: false, refreshing: false, failure }),

                            // Persist cooldown deadlines as well as results so unmounting does not reset retry pressure.
                            tap((state) => {
                              if (log.enabled)
                                log(state.failure ? "Resolution unavailable" : "Resolution succeeded", key, {
                                  value: state.value,
                                  origin: state.origin,
                                  failure: state.failure,
                                });

                              if (retained) retained.freshUntil = undefined;
                              failures = state.failure ? failures + 1 : 0;
                              retryAt = state.failure ? clock.now() + retryInterval() : undefined;
                              cache.delete(key);
                              cache.set(key, { policy, state, retryAt, write: stored?.write });
                              if (!state.failure && persistent) {
                                const lifetime = ttl(query);
                                const retention = options.cacheRetention ?? 24 * 60 * 60_000;
                                const record: CountCacheRecord = {
                                  version: 1,
                                  policy,
                                  state,
                                  freshUntil: lifetime === Infinity ? null : state.observedAt! + lifetime,
                                  retainUntil: retention === Infinity ? null : state.observedAt! + retention,
                                };
                                // Keep the epoch captured before resolution so invalidation fences delayed writes.
                                if (stored)
                                  void stored.write(record).catch((error) => log("Cache write failed", key, error));
                              }
                              trim();
                            }),
                          );
                      });

                    // Only an observed metric schedules its next TTL refresh or failed-attempt retry.
                    const cycle = (state: CountState): Observable<CountState> => {
                      const delay = state.failure
                        ? Math.max(1, (retryAt ?? clock.now() + retryInterval()) - clock.now())
                        : Math.max(
                            minimum,
                            Math.min(
                              ttl(query) - (clock.now() - (state.observedAt ?? clock.now())),
                              retained?.freshUntil == null ? Infinity : retained.freshUntil - clock.now(),
                            ),
                          );

                      // An infinite successful TTL keeps the lifecycle open without allocating a timer.
                      if (delay === Infinity) {
                        log("Automatic refresh disabled", key);
                        return NEVER;
                      }

                      log(state.failure ? "Retry scheduled" : "Refresh scheduled", key, "delay", delay);

                      return timer(delay, clock).pipe(
                        switchMap(() => concat(of({ ...state, fresh: false, refreshing: true }), resolve(state))),
                      );
                    };

                    const settled$ = fresh || coolingDown ? of(initial) : resolve(initial);

                    // Emit cache state synchronously, then drive subsequent cycles from settled states only.
                    return concat(
                      of(initial),
                      settled$.pipe(expand((state) => (state.refreshing ? EMPTY : cycle(state)), 1)),
                    );
                  }),
                );
              }),
            ),
          ),

          tap((state) => {
            if (!firstValue && state.value !== undefined) {
              firstValue = true;
              diagnostic("first-value", clock.now() - began);
            }
          }),

          // Service shutdown cancels policy observation, queued/running work, and refresh timers together.
          takeUntil(stopped$),

          // Last-unsubscribe teardown removes the canonical stream while leaving bounded cache retention.
          finalize(() => {
            log("Metric released", key);
            registry.delete(key);
            trim();
            diagnostic("released");
          }),

          // Share demand across value and metadata observers; reconnect through the separate cache after teardown.
          share({
            connector: () => new ReplaySubject<CountState>(1),
            resetOnComplete: true,
            resetOnError: true,
            resetOnRefCountZero: true,
          }),
        );

        registry.set(key, canonical);
      }

      return canonical;
    });

  const service: CountService = {
    event: (target) => {
      const metric = (descriptor: CountMetric) => chainable(stateFor({ target, metric: descriptor }));
      const reactions = metric(reactionCountMetric);

      // Legacy note references are deliberately explicit; comments always means NIP-22 root comments.
      const comments = metric(rootCommentCountMetric);

      return {
        reactions,
        comments,

        // Metadata changes should not re-emit an unchanged numeric value.
        reactions$: reactions.pipe(
          map((s) => s.value),
          distinctUntilChanged(),
        ),
        comments$: comments.pipe(
          map((s) => s.value),
          distinctUntilChanged(),
        ),
        metric,
      };
    },

    invalidate: (target) => {
      const identity = target && targetKey(target);
      log("Invalidated", identity ?? "all targets");

      for (const key of cache.keys()) if (!identity || JSON.parse(key)[0] === identity) cache.delete(key);

      // Queue the persistent epoch change before active subscriptions hydrate again.
      const deletion = persistent?.invalidate(identity) ?? Promise.resolve();
      invalidated$.next(identity);
      return deletion.catch((error) => {
        log("Cache invalidation failed", error);
        throw error;
      });
    },

    stop: () => {
      runtimeEvents?.unsubscribe();
      if (!options.runtime) runtime?.stop();
      if (!stopped) {
        log("Stopped", "observed metrics", registry.size, "cached entries", cache.size);
        stopped = true;
        stopped$.next();
        stopped$.complete();
        cache.clear();
        registry.clear();
        invalidated$.complete();
        options.signal?.removeEventListener("abort", service.stop);
      }
    },
  };

  const runtimeEvents = runtime?.events$.subscribe((event) => {
    activity = { active: event.active, pending: event.pending };
    options.diagnostic?.({ ...event, cacheEntries: cache.size, activeMetrics: registry.size });
  });
  if (options.signal?.aborted) service.stop();
  else options.signal?.addEventListener("abort", service.stop, { once: true });

  return service;
}
