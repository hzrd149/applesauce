import { logger as baseLogger, type Debugger } from "applesauce-core";
import { mergeRelaySets, type Filter } from "applesauce-core/helpers";
import { chainable, type ChainableObservable } from "applesauce-core/observable";
import {
  BehaviorSubject,
  catchError,
  concat,
  defaultIfEmpty,
  defer,
  distinctUntilChanged,
  EMPTY,
  expand,
  filter,
  finalize,
  firstValueFrom,
  from,
  isObservable,
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
  timer,
  timeout,
  type SchedulerLike,
  Subscription,
} from "rxjs";
import {
  createCountScheduler,
  validateCountTimeout,
  type CountScheduler,
  type CountRelayPool,
  type CountRelayStatus,
} from "./count-scheduler.js";

/** A static or reactive configuration list */
export type CountList<T> = readonly T[] | Observable<readonly T[]>;

/** A target identified by event ID, or an explicitly selected stable address */
export interface CountTarget {
  /** The event ID */
  id: string;

  /** The event creation time in seconds */
  created_at: number;

  /** The event kind */
  kind: number;

  /** The stable address when counting an address instead of a revision */
  address?: string;
}

/** A named event count defined by COUNT filters */
export interface CountMetric {
  /** The stable semantic identifier, including a version */
  id: string;

  /** The COUNT filters, or undefined for unsupported targets */
  filters: (target: CountTarget) => Filter[] | undefined;
}

/** A request for one target and semantic metric */
export interface CountQuery {
  /** The target event or address */
  target: CountTarget;

  /** The requested metric */
  metric: CountMetric;
}

/** The provenance of a selected count */
export interface CountOrigin {
  /** The selected relay */
  relay: string;
}

/** The state of one independently observed metric */
export interface CountState {
  /** The selected count, or undefined when unavailable */
  value: number | undefined;

  /** Whether the retained value is still fresh */
  fresh: boolean;

  /** Whether a resolution is underway */
  refreshing: boolean;

  /** The selected relay provenance */
  origin: CountOrigin | undefined;

  /** Whether the selected relay supplied an approximation */
  approximate: boolean | undefined;

  /** The fetch time in milliseconds */
  observedAt: number | undefined;

  /** The local metric or scheduler error, excluding retried relay failures */
  failure: unknown | undefined;
}

/** A bounded snapshot of service-owned work and retention */
export interface CountDiagnostic {
  /** The activity or lifecycle notification */
  type: string;

  /** The active transport count */
  active: number;

  /** The outstanding subscribed count requests */
  requests: number;

  /** The retained result cache entries */
  cacheEntries: number;

  /** The canonical observed metric entries */
  activeMetrics: number;

  /** The measured duration in milliseconds for timing diagnostics */
  latency?: number;

  /** The current per-relay admission measurements when using a RelayPool */
  relays?: readonly CountRelayStatus[];
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
  /** The effective relay policy */
  policy: string;
  /** The successful count state */
  state: CountState;
  /** The absolute freshness deadline, or null for unlimited freshness */
  freshUntil: number | null;
  /** The absolute retention deadline, or null for unlimited retention */
  retainUntil: number | null;
}

/** The context used to choose metric freshness */
export interface CountFreshnessContext {
  /** The target's age in seconds */
  age: number;
  /** The target and metric being resolved */
  query: CountQuery;
}

/** Options for demand-driven event metric counts */
export interface CountServiceOptions {
  /** The app-owned relay scheduler shared across services */
  countScheduler?: CountScheduler;

  /** The optional Keyv-compatible persistent count cache; use a dedicated namespace */
  cache?: CountCache;

  /** The persistent retention lifetime in milliseconds, default 24 hours */
  cacheRetention?: number;

  /** The maximum cache operation duration in milliseconds, default 1000 and maximum 2147483647 */
  cacheTimeout?: number;

  /** The maximum active COUNT requests per relay, default 20 */
  concurrency?: number;

  /** The trusted relay list for balanced NIP-45 counts */
  relays: CountList<string>;

  /** The freshness curve receiving event age in seconds and returning milliseconds, defaulting to 1 minute through 6 hours */
  ttl?: (context: CountFreshnessContext) => number;

  /** The maximum inactive cached result entries, default 1000 */
  cacheCapacity?: number;

  /** The transport response budget including authentication in milliseconds, default 5000 and maximum 2147483647 */
  attemptTimeout?: number;

  /** The minimum refresh interval in milliseconds, default 1000 */
  minimumRefresh?: number;

  /** The clock for deadlines and deterministic tests */
  scheduler?: SchedulerLike;

  /** The deterministic random source for relay cooldown jitter */
  random?: () => number;

  /** The optional service cancellation signal */
  signal?: AbortSignal;

  /** The parent logger for the service and its relay attempts */
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
  filters: (target) => (target.address ? undefined : [{ kinds: [7], "#e": [target.id] }]),
};

/** The legacy kind-1 reference count, including indirect thread references */
export const legacyReferenceCountMetric: CountMetric = {
  id: "legacy-references:v1",
  filters: (target) => (target.address ? undefined : [{ kinds: [1], "#e": [target.id] }]),
};

/** The NIP-22 root comment count, including the entire comment tree */
export const rootCommentCountMetric: CountMetric = {
  id: "root-comments:v1",
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
 * Creates lazy shared metrics with balanced COUNT requests to a flat trusted relay set
 * @throws if concurrency, timeouts, cache settings, or scheduler clocks are invalid
 */
export function createCountService(pool: CountRelayPool, options: CountServiceOptions): CountService {
  const log = (options.logger ?? baseLogger).extend("count-service");
  const relayLog = log.extend("relay");
  const routes = new BehaviorSubject({ relays: [] as readonly string[], policy: "[]" });
  const scheduler =
    options.countScheduler ??
    createCountScheduler({
      concurrency: options.concurrency,
      scheduler: options.scheduler,
      random: options.random,
    });
  if (options.scheduler && scheduler.scheduler !== options.scheduler)
    throw new Error("Count service and scheduler must use the same clock");
  if (options.countScheduler && options.concurrency !== undefined)
    throw new Error("Configure concurrency on the shared countScheduler");
  const positive = (name: string, value: number) => {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);

    return value;
  };

  const clock = scheduler.scheduler;
  const minimum = positive("minimumRefresh", options.minimumRefresh ?? 1000);
  const attempt = validateCountTimeout("attemptTimeout", options.attemptTimeout ?? 5000);
  const cacheTimeout = validateCountTimeout("cacheTimeout", options.cacheTimeout ?? 1000);
  if (options.cacheRetention !== undefined && options.cacheRetention !== Infinity)
    positive("cacheRetention", options.cacheRetention);
  const persistent = options.cache && createPersistentCountCache(options.cache, clock, cacheTimeout);
  const capacity = options.cacheCapacity ?? 1000;
  if (!Number.isInteger(capacity) || capacity < 0) throw new Error("cacheCapacity must be a nonnegative integer");

  let activity = { active: 0, requests: 0 };
  const diagnostic = (type: string, latency?: number) =>
    options.diagnostic?.({ type, latency, ...activity, cacheEntries: cache.size, activeMetrics: registry.size });

  const stopped$ = new ReplaySubject<void>(1);
  const invalidated$ = new Subject<string | undefined>();
  let stopped = false;

  // Retain values separately from the registry of currently observed streams.
  const cache = new Map<
    string,
    {
      policy: string;
      state: CountState;
      freshUntil?: number | null;
      write?: (record: CountCacheRecord) => Promise<void>;
    }
  >();
  const registry = new Map<string, Observable<CountState>>();

  const targetKey = (target: CountTarget) => (target.address ? `a:${target.address}` : `e:${target.id}`);
  const keyFor = (query: CountQuery) => JSON.stringify([targetKey(query.target), query.metric.id]);

  // Only inactive entries are evictable; observed metrics remain pinned.
  const trim = () => {
    const inactive = [...cache.keys()].filter((key) => !registry.has(key));
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

        canonical = routes.pipe(
          tap(() => log("Relay set observed", key)),
          // A relay-set change cancels obsolete work before exposing retained values.
          switchMap(({ relays, policy }) =>
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
                    const record = stored?.record;
                    if ((!cache.has(key) || cache.get(key)?.policy !== policy) && record) {
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
                    diagnostic(fresh ? "cache-hit" : "cache-miss");
                    log("Cache %s", fresh ? "hit" : "miss", key);

                    // Expose retained data immediately while stale counts are requested.
                    const initial: CountState = old
                      ? { ...old, fresh, refreshing: !fresh }
                      : {
                          value: undefined,
                          fresh: false,
                          refreshing: true,
                          origin: undefined,
                          approximate: undefined,
                          observedAt: undefined,
                          failure: undefined,
                        };

                    // Each resolution settles once; failures preserve the previous successful value and provenance.
                    const resolve = (previous: CountState): Observable<CountState> =>
                      defer(() => {
                        let failure: unknown = new Error("Count scheduler completed without a response");
                        log("Resolution started", key);

                        return defer(() => {
                          const filters = query.metric.filters(query.target);
                          if (!filters?.length) throw new Error("Metric does not support this target");
                          return scheduler.count(pool, relays, filters, {
                            attemptTimeout: attempt,
                            diagnostic: (type, latency) => {
                              relayLog("COUNT %s", type, key, latency);
                              diagnostic(type, latency);
                            },
                          });
                        }).pipe(
                          map(({ relay, response }): CountState => ({
                            value: response.count,
                            origin: { relay },
                            approximate: response.approximate,
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

                          // Cache settled states; relay cooldowns belong to the scheduler.
                          tap((state) => {
                            if (log.enabled)
                              log(state.failure ? "Resolution unavailable" : "Resolution succeeded", key, {
                                value: state.value,
                                origin: state.origin,
                                failure: state.failure,
                              });

                            if (retained) retained.freshUntil = undefined;
                            cache.delete(key);
                            cache.set(key, { policy, state, write: stored?.write });
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

                    // Only successful observed counts schedule a freshness refresh.
                    const cycle = (state: CountState): Observable<CountState> => {
                      // Invalid filters require a caller correction or explicit invalidation, not network retries.
                      if (state.failure) return NEVER;
                      const delay = Math.max(
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

                      log("Refresh scheduled", key, "delay", delay);

                      return timer(delay, clock).pipe(
                        switchMap(() => concat(of({ ...state, fresh: false, refreshing: true }), resolve(state))),
                      );
                    };

                    const settled$ = fresh ? of(initial) : resolve(initial);

                    // Emit cache state synchronously, then drive subsequent cycles from settled states only.
                    const updates$ = settled$.pipe(expand((state) => (state.refreshing ? EMPTY : cycle(state))));
                    return fresh ? updates$ : concat(of(initial), updates$);
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

          // Service shutdown cancels policy observation, outstanding requests, and refresh timers together.
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
      if (stopped) return;
      stopped = true;
      log("Stopped", "observed metrics", registry.size, "cached entries", cache.size);
      schedulerEvents.unsubscribe();
      routeSubscription.unsubscribe();
      stopped$.next();
      stopped$.complete();
      releaseRoutes?.();
      routes.complete();
      if (!options.countScheduler) scheduler.stop();
      cache.clear();
      registry.clear();
      invalidated$.complete();
      options.signal?.removeEventListener("abort", service.stop);
    },
  };

  const schedulerEvents = scheduler.status$.subscribe((event) => {
    activity = { active: event.active, requests: event.requests };
    options.diagnostic?.({ ...event, type: "scheduler", cacheEntries: cache.size, activeMetrics: registry.size });
  });
  let releaseRoutes: (() => void) | undefined;
  const routeSubscription = new Subscription();
  routeSubscription.add(
    (isObservable(options.relays) ? options.relays : of(options.relays))
      .pipe(
        catchError(() => of([] as readonly string[])),
        map((urls) => mergeRelaySets(urls).sort()),
        distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b)),
      )
      .subscribe((urls) => {
        const previous = releaseRoutes;
        releaseRoutes = scheduler.retain(urls);
        previous?.();
        routes.next({ relays: urls, policy: JSON.stringify(urls) });
      }),
  );
  if (options.signal?.aborted) service.stop();
  else options.signal?.addEventListener("abort", service.stop, { once: true });

  return service;
}

function isValidRecord(value: unknown, policy: string, now: number): value is CountCacheRecord {
  const record = value as CountCacheRecord | undefined;
  return !!(
    record &&
    record.version === 1 &&
    record.policy === policy &&
    record.state &&
    Number.isSafeInteger(record.state.value) &&
    record.state.value! >= 0 &&
    Number.isFinite(record.state.observedAt) &&
    record.state.observedAt! <= now &&
    record.state.failure === undefined &&
    record.state.origin &&
    typeof record.state.origin.relay === "string" &&
    (record.state.approximate === undefined || typeof record.state.approximate === "boolean") &&
    (record.freshUntil === null || Number.isFinite(record.freshUntil)) &&
    (record.retainUntil === null || (Number.isFinite(record.retainUntil) && record.retainUntil > now))
  );
}

// Epoch keys let invalidation cover entries written by earlier sessions without enumerating or clearing the store.
/** Creates bounded persistent cache access with policy-scoped invalidation */
function createPersistentCountCache(cache: CountCache, clock: SchedulerLike, deadline: number) {
  let pending: Promise<unknown> = Promise.resolve();
  const run = <T>(action: () => Promise<T>, ordered = true): Promise<T> => {
    let expired = false;
    const task = pending.then(() => {
      if (expired) throw new Error("Count cache operation expired before execution");
      return action();
    });
    // Include queue wait in the deadline, and never start an operation that already timed out.
    const result = firstValueFrom(from(task).pipe(timeout({ first: deadline, scheduler: clock }))).catch((error) => {
      expired = true;
      throw error;
    });
    if (ordered) pending = result.catch(() => undefined);
    return result;
  };
  const prefix = "applesauce:counts:v1:";
  const globalKey = `${prefix}epoch`;
  const targetEpochKey = (target: string) => `${prefix}target:${target}`;
  const token = () => globalThis.crypto.randomUUID();

  return {
    read: (target: string, metric: string, policy: string) =>
      run(async () => {
        const global = await cache.get(globalKey);
        const local = await cache.get(targetEpochKey(target));
        if ((global !== undefined && typeof global !== "string") || (local !== undefined && typeof local !== "string"))
          throw new Error("Invalid count cache epoch");
        const key = prefix + JSON.stringify([global ?? "", local ?? "", target, metric, policy]);
        const record = await cache.get(key);
        return {
          record: isValidRecord(record, policy, clock.now()) ? record : undefined,
          write: (value: CountCacheRecord) =>
            run(async () => {
              const remaining = value.retainUntil === null ? 0 : value.retainUntil - clock.now();
              if (value.retainUntil !== null && remaining <= 0) return;
              await cache.set(key, value, remaining);
            }),
        };
      }, false),
    invalidate: (target?: string) =>
      run(async () => {
        await cache.set(target === undefined ? globalKey : targetEpochKey(target), token(), 0);
      }),
  };
}
