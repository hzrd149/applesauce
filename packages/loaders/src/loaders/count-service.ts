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
import { createTransportScheduler } from "../helpers/count-service/scheduler.js";
import { fallbackCountSource } from "./count-sources/fallback.js";
import { nip85CountSource, type Nip85CountSourceOptions } from "./count-sources/nip85.js";
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

  /** The first-value latency in milliseconds, when reporting first-value */
  latency?: number;
}

/** Options for demand-driven event metric counts */
export interface CountServiceOptions {
  /** The explicit ordered hierarchy, overriding automatic source creation */
  sources?: readonly CountSource[];

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

  /** The freshness curve, receiving event age in seconds and returning milliseconds */
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

  /** Invalidates retained results for one target or all targets */
  invalidate(target?: CountTarget): void;

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
  const sources = options.sources ?? [
    ...(options.providers
      ? [nip85CountSource({ pool: options.pool, request: options.request, providers: options.providers })]
      : []),
    ...(options.relays ? [relayCountSource({ pool: options.pool, count: options.count, relays: options.relays })] : []),
  ];

  const positive = (name: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);

    return value;
  };

  const clock = options.scheduler ?? asyncScheduler;
  const minimum = positive("minimumRefresh", options.minimumRefresh ?? 1000);
  const retry = positive("retryDelay", options.retryDelay ?? 10000);
  const deadline = positive("resolutionTimeout", options.resolutionTimeout ?? 15000);
  const attempt = positive("attemptTimeout", options.attemptTimeout ?? 5000);
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
  const transport = createTransportScheduler({
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

  const resolver = fallbackCountSource(sources);
  const stopped$ = new ReplaySubject<void>(1);
  const invalidated$ = new Subject<string | undefined>();
  let stopped = false;

  // Retain values and cooldowns separately from the registry of currently observed streams.
  const cache = new Map<string, { policy: string; state: CountState; retryAt?: number }>();
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
    const value = options.ttl?.({ age, query }) ?? (age < 3600 ? 30000 : 300000);

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
              map((value) => JSON.stringify(value)),
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
                  !old?.failure && old?.observedAt !== undefined && clock.now() - old.observedAt < ttl(query);
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

                  return Math.min(60000, retry * 2 ** Math.min(5, Math.max(0, failures - 1))) * (0.8 + 0.4 * jitter);
                };

                // Each resolution settles once; failures preserve the previous successful value and provenance.
                const resolve = (previous: CountState): Observable<CountState> =>
                  defer(() => {
                    let failure: unknown = new Error("No count source answered");
                    log("Resolution started", key, "timeout", deadline);

                    return resolver
                      .count(query, {
                        deadline: clock.now() + deadline,
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

                          failures = state.failure ? failures + 1 : 0;
                          retryAt = state.failure ? clock.now() + retryInterval() : undefined;
                          cache.delete(key);
                          cache.set(key, { policy, state, retryAt });
                          trim();
                        }),
                      );
                  });

                // Only an observed metric schedules its next TTL refresh or failed-attempt retry.
                const cycle = (state: CountState): Observable<CountState> => {
                  const delay = state.failure
                    ? Math.max(1, (retryAt ?? clock.now() + retryInterval()) - clock.now())
                    : Math.max(minimum, ttl(query) - (clock.now() - (state.observedAt ?? clock.now())));

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

      // Observed targets restart immediately; unobserved targets load on their next subscription.
      invalidated$.next(identity);
    },

    stop: () => {
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

  if (options.signal?.aborted) service.stop();
  else options.signal?.addEventListener("abort", service.stop, { once: true });

  return service;
}
