import { normalizeURL } from "applesauce-core/helpers/url";
import type { Filter } from "applesauce-core/helpers";
import type { Relay, RelayCountResponse } from "applesauce-relay";
import {
  asyncScheduler,
  BehaviorSubject,
  defer,
  finalize,
  map,
  Observable,
  Subscriber,
  Subscription,
  take,
  throwIfEmpty,
  timeout,
  type SchedulerLike,
} from "rxjs";

/**
 * Validates a timeout budget against the JavaScript timer range
 * @internal
 * @throws if the budget is not positive, finite, or within the signed 32-bit timer limit
 */
export function validateCountTimeout(name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value > 2_147_483_647)
    throw new Error(`${name} must be positive and at most 2147483647 ms (about 24.8 days)`);
  return value;
}

/** A pool providing shared Relay instances for individual COUNT attempts */
export interface CountRelayPool {
  /** Gets or creates a relay by URL */
  relay(url: string): Pick<Relay, "count">;
}

/** Options for balanced relay admission */
export interface CountSchedulerOptions {
  /** The maximum active attempts per relay, default 20 */
  concurrency?: number;
  /** The clock for attempt deadlines and relay cooldowns */
  scheduler?: SchedulerLike;
  /** The deterministic random source for cooldown jitter */
  random?: () => number;
}

/** A relay's current admission and response measurements */
export interface CountRelayStatus {
  /** The normalized relay URL */
  relay: string;
  /** The number of active attempts */
  active: number;
  /** The configured maximum concurrency */
  maximum: number;
  /** The current adaptive concurrency limit */
  limit: number;
  /** The smoothed wire response latency in milliseconds */
  latency?: number;
  /** The relay's baseline wire response latency in milliseconds */
  baseline?: number;
  /** The number of measured successful responses */
  samples: number;
  /** The time of the last measured response */
  sampledAt?: number;
  /** The current cooldown deadline in milliseconds */
  cooldownUntil: number;
  /** The most recent classified failure */
  failure?: CountFailure;
}

/** A classified COUNT failure independent of arbitrary relay notices */
export type CountFailure =
  "rate-limit" | "transport" | "timeout" | "auth" | "unsupported" | "invalid-query" | "malformed" | "refused";

/** The activity of a shared count scheduler */
export interface CountSchedulerStatus {
  /** The number of active attempts */
  active: number;
  /** The number of outstanding subscribed requests */
  requests: number;
  /** The currently retained relay records */
  relays: readonly CountRelayStatus[];
}

/** The budgets and instrumentation for one logical resolution */
export interface CountScheduleOptions {
  /** The wall-clock budget per attempt in milliseconds, including readiness and authentication, at most 2147483647 */
  attemptTimeout: number;
  /** Reports attempt outcomes and transport duration */
  diagnostic?: (type: string, latency?: number) => void;
}

/** A successful answer from exactly one trusted relay */
export interface ScheduledCount {
  /** The selected normalized relay URL */
  relay: string;
  /** The validated COUNT response */
  response: RelayCountResponse;
}

/** A shared registry of persistent demand with adaptive per-relay admission */
export interface CountScheduler {
  /** The clock shared by participating services */
  scheduler: SchedulerLike;
  /** Emits current capacity, activity, and response measurements */
  status$: Observable<CountSchedulerStatus>;
  /**
   * Retains a trusted relay set until the returned release function is called
   * @throws if a URL is invalid
   */
  retain(relays: readonly string[]): () => void;
  /** Keeps trying a subscribed request until one relay answers or the consumer cancels */
  count(
    pool: CountRelayPool,
    relays: readonly string[],
    filters: Filter[],
    options: CountScheduleOptions,
  ): Observable<ScheduledCount>;
  /** Cancels all work and removes retained state without closing the pool */
  stop(): void;
}

/** Returns the structured failure category for a relay error */
function classifyCountFailure(error: unknown): CountFailure {
  const name = error instanceof Error ? error.name : "";
  if (["AuthRequiredError", "AuthHandlerError", "AuthTimeoutError"].includes(name)) return "auth";
  if (name === "RelayCountResponseError") return "malformed";
  if (name === "TimeoutError") return "timeout";
  if (name === "RelayClosedError") {
    const reason = (error as Error & { reason?: string }).reason ?? "";
    if (reason.startsWith("rate-limited:")) return "rate-limit";
    if (reason.startsWith("unsupported:")) return "unsupported";
    if (reason.startsWith("invalid:")) return "invalid-query";
    return "refused";
  }
  return "transport";
}

function countResponseError(message: string): Error {
  const error = new Error(message);
  error.name = "RelayCountResponseError";
  return error;
}

function validateResponse(response: RelayCountResponse): RelayCountResponse {
  if (
    !response ||
    typeof response !== "object" ||
    !Number.isSafeInteger(response.count) ||
    response.count < 0 ||
    (response.approximate !== undefined && typeof response.approximate !== "boolean")
  )
    throw countResponseError("Invalid COUNT response");
  return response;
}

/**
 * Creates balanced relay selection with fast ramp-up and congestion-driven backoff
 * @throws if concurrency is not a positive safe integer
 */
export function createCountScheduler(options: CountSchedulerOptions = {}): CountScheduler {
  const maximum = options.concurrency ?? 20;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new Error("Count concurrency must be a positive safe integer");
  const clock = options.scheduler ?? asyncScheduler;
  type RecordState = CountRelayStatus & {
    owners: number;
    generation: number;
    streak: number;
    updated: number;
    started: number;
    slowStart: boolean;
    timer?: Subscription;
  };
  type Demand = {
    subscriber: Subscriber<ScheduledCount>;
    pool: CountRelayPool;
    relays: readonly string[];
    attempted: Set<string>;
    active: boolean;
    retryAt: number;
    filters: Filter[];
    options: CountScheduleOptions;
  };
  const records = new Map<string, RecordState>();
  const demands = new Set<Demand>();
  const lifetime = new Subscription();
  const status = new BehaviorSubject<CountSchedulerStatus>({ active: 0, requests: 0, relays: [] });
  let stopped = false;
  let dispatching = false;
  let dispatches = 0;
  let deferredDispatch: Subscription | undefined;
  let retryTask: Subscription | undefined;
  const publish = () =>
    status.next({
      active: [...records.values()].reduce((n, state) => n + state.active, 0),
      requests: demands.size,
      relays: [...records.values()].map(
        ({ relay, active, limit, latency, baseline, samples, sampledAt, cooldownUntil, failure }) => ({
          relay,
          active,
          maximum,
          limit,
          latency,
          baseline,
          samples,
          sampledAt,
          cooldownUntil,
          failure,
        }),
      ),
    });
  const prune = (state: RecordState) => {
    if (!state.owners && !state.active) {
      state.timer?.unsubscribe();
      records.delete(state.relay);
    }
  };
  const choose = (demand: Demand) => {
    if (demand.active || demand.retryAt > clock.now()) return undefined;
    const eligible = demand.relays
      .filter((url) => !demand.attempted.has(url))
      .map((url) => records.get(url))
      .filter((s): s is RecordState => !!s && s.owners > 0 && s.active < s.limit && s.cooldownUntil <= clock.now());
    // One in sixteen dispatches revisits an idle endpoint whose measurement is stale.
    const stale = eligible.filter((s) => !s.active && clock.now() - (s.sampledAt ?? -Infinity) > 30_000);
    if (dispatches % 16 === 15 && stale.length) return stale.sort((a, b) => a.started - b.started)[0];
    const measured = eligible
      .map((s) => s.latency)
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    const cold = measured[Math.floor(measured.length / 2)] ?? 100;
    const score = (s: RecordState) => (!s.samples && !s.active ? 0 : (s.active + 1) * (s.latency ?? cold));
    return eligible.sort((a, b) => score(a) - score(b) || a.started - b.started)[0];
  };
  const sample = (state: RecordState, latency: number) => {
    if (state.sampledAt !== undefined && clock.now() - state.sampledAt > 30_000) {
      state.baseline = undefined;
      state.latency = undefined;
      state.updated = clock.now();
    }
    const value = Math.max(1, latency);
    state.samples++;
    state.sampledAt = clock.now();
    state.baseline = state.baseline ? Math.min(value, state.baseline * 1.001) : value;
    state.latency = state.latency ? state.latency * 0.8 + value * 0.2 : value;
  };
  const fail = (state: RecordState, error: unknown, generation: number, elapsed: number) => {
    if (state.generation !== generation) return;
    const category = classifyCountFailure(error);
    if (category === "invalid-query") return;
    state.failure = category;
    // A slow relay is not congested; ranking it lower moves demand to faster relays.
    if (category === "timeout") return sample(state, elapsed);
    state.generation++;
    state.streak = Math.min(6, state.streak + 1);
    const congestion = category === "transport" || category === "rate-limit";
    if (congestion) {
      state.slowStart = false;
      state.limit = Math.max(1, Math.floor(state.limit / 2));
    }
    const random = (options.random ?? Math.random)();
    const jitter = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5;
    // Native timers truncate fractional milliseconds; never wake before the cooldown deadline.
    const delay = Math.ceil(
      congestion ? Math.min(30_000, 1000 * 2 ** (state.streak - 1)) * (0.8 + 0.4 * jitter) : 30_000,
    );
    state.updated = clock.now();
    state.cooldownUntil = clock.now() + delay;
    state.timer?.unsubscribe();
    state.timer = clock.schedule(() => {
      state.timer = undefined;
      dispatchReady();
    }, delay);
  };
  const succeed = (state: RecordState, latency: number | undefined, generation: number) => {
    if (state.generation !== generation) return;
    state.failure = undefined;
    state.streak = 0;
    if (latency === undefined) return;
    sample(state, latency);
    // Grow a saturated relay at most once per round trip, doubling until its first congestion signal.
    if (state.active >= state.limit && clock.now() - state.updated >= Math.max(100, state.latency!)) {
      state.updated = clock.now();
      state.limit = Math.min(maximum, state.slowStart ? state.limit * 2 : state.limit + 1);
    }
  };
  const scheduleRetry = () => {
    retryTask?.unsubscribe();
    retryTask = undefined;
    let next = Infinity;
    for (const demand of demands)
      if (!demand.active && demand.retryAt > clock.now()) next = Math.min(next, demand.retryAt);
    if (next !== Infinity)
      retryTask = clock.schedule(() => {
        retryTask = undefined;
        dispatchReady();
      }, next - clock.now());
  };
  const start = (demand: Demand, state: RecordState) => {
    demand.active = true;
    demand.attempted.add(state.relay);
    state.active++;
    state.started = ++dispatches;
    const generation = state.generation;
    const began = clock.now();
    let sentAt: number | undefined;
    let received = false;
    let attemptError: unknown;
    const upstream = new Subscriber<RelayCountResponse>({
      next: (response) => {
        received = true;
        succeed(state, sentAt === undefined ? undefined : clock.now() - sentAt, generation);
        demand.options.diagnostic?.("answered");
        demand.subscriber.next({ relay: state.relay, response });
        demand.subscriber.complete();
      },
      error: (error: unknown) => {
        attemptError = error === undefined ? new Error("COUNT attempt failed without an error value") : error;
      },
      complete: () => {},
    });
    demand.subscriber.add(upstream);

    // Finalization runs after transport teardown, including synchronous answers and failures.
    const release = () => {
      demand.subscriber.remove(upstream);
      state.active--;
      demand.active = false;
      if (attemptError !== undefined && !demand.subscriber.closed) {
        fail(state, attemptError, generation, clock.now() - (sentAt ?? began));
        demand.options.diagnostic?.(classifyCountFailure(attemptError));
      } else if (!received) demand.options.diagnostic?.("cancelled");
      demand.options.diagnostic?.("transport-duration", clock.now() - began);
      prune(state);
      if (attemptError !== undefined && !demand.subscriber.closed) {
        // Move failed demand behind other observers and pause between complete relay rounds.
        demands.delete(demand);
        if (demand.attempted.size >= demand.relays.length) {
          demand.attempted.clear();
          demand.retryAt = clock.now() + 1000;
        }
        demands.add(demand);
      }
      // Coalesce cancellations before admitting replacement viewport work.
      if (!received && attemptError === undefined && demands.size) {
        if (!deferredDispatch)
          deferredDispatch = clock.schedule(() => {
            deferredDispatch = undefined;
            dispatchReady();
          });
        publish();
      } else dispatchReady();
    };
    demand.options.diagnostic?.("dispatched");
    publish();
    // A diagnostic observer can cancel demand before the transport is subscribed.
    if (upstream.closed) {
      release();
      return;
    }

    const response$ = defer(() =>
      demand.pool.relay(state.relay).count(demand.filters, undefined, {
        retries: false,
        reconnect: false,
        timeout: false,
        authTimeout: demand.options.attemptTimeout,
        onSent: () => {
          sentAt = clock.now();
        },
      }),
    );
    response$
      .pipe(
        timeout({ first: demand.options.attemptTimeout, scheduler: clock }),
        map(validateResponse),
        take(1),
        throwIfEmpty(() => countResponseError("COUNT completed without a response")),
        finalize(release),
      )
      .subscribe(upstream);
  };

  function dispatchReady() {
    if (dispatching || stopped) return;
    dispatching = true;
    try {
      let ready: { demand: Demand; relay: RecordState } | undefined;
      do {
        ready = undefined;
        for (const demand of demands) {
          if (demand.subscriber.closed) continue;
          const relay = choose(demand);
          if (relay) {
            ready = { demand, relay };
            break;
          }
        }
        if (ready) start(ready.demand, ready.relay);
      } while (ready && !stopped);
    } finally {
      dispatching = false;
    }
    scheduleRetry();
    publish();
  }
  return {
    scheduler: clock,
    status$: status.asObservable(),
    retain: (urls) => {
      if (stopped) return () => {};
      const normalized = [...new Set(urls.map(normalizeURL))];
      for (const relay of normalized) {
        let state = records.get(relay);
        if (!state) {
          state = {
            relay,
            maximum,
            active: 0,
            limit: Math.min(8, maximum),
            samples: 0,
            cooldownUntil: 0,
            owners: 0,
            generation: 0,
            streak: 0,
            updated: -Infinity,
            started: 0,
            slowStart: true,
          };
          records.set(relay, state);
        }
        state.owners++;
      }
      dispatchReady();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        for (const relay of normalized) {
          const state = records.get(relay);
          if (state) {
            state.owners--;
            prune(state);
          }
        }
        publish();
      };
    },
    count: (pool, urls, filters, request) =>
      new Observable((subscriber) => {
        if (stopped) {
          subscriber.complete();
          return;
        }
        validateCountTimeout("attemptTimeout", request.attemptTimeout);
        lifetime.add(subscriber);
        const demand: Demand = {
          subscriber,
          pool,
          relays: [...new Set(urls.map(normalizeURL))],
          attempted: new Set(),
          active: false,
          retryAt: 0,
          filters,
          options: request,
        };
        subscriber.add(() => {
          demands.delete(demand);
          lifetime.remove(subscriber);
          if (!demands.size) {
            deferredDispatch?.unsubscribe();
            deferredDispatch = undefined;
          }
          for (const state of records.values()) prune(state);
          scheduleRetry();
          publish();
        });
        demands.add(demand);
        dispatchReady();
      }),
    stop: () => {
      if (stopped) return;
      stopped = true;
      lifetime.unsubscribe();
      deferredDispatch?.unsubscribe();
      retryTask?.unsubscribe();
      for (const state of records.values()) state.timer?.unsubscribe();
      records.clear();
      demands.clear();
      publish();
      status.complete();
    },
  };
}
