import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BehaviorSubject,
  firstValueFrom,
  filter,
  NEVER,
  Observable,
  of,
  Subject,
  Subscription,
  throwError,
  timer,
  map,
  VirtualTimeScheduler,
} from "rxjs";
import Keyv from "keyv";
import { WS } from "vitest-websocket-mock";
import { RelayPool } from "../../../../relay/src/pool.js";
import { Relay } from "../../../../relay/src/relay.js";
import {
  createCountScheduler,
  createCountService,
  type CountCache,
  type CountMetric,
  type CountServiceOptions,
  type CountState,
} from "../index.js";

const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
const relay = "wss://relay.test/";
const services: ReturnType<typeof createCountService>[] = [];
afterEach(() => {
  services.splice(0).forEach((s) => s.stop());
  vi.useRealTimers();
});
function setup(options: Partial<CountServiceOptions> = {}, transport: Relay["count"] = () => of({ count: 5 })) {
  const count = vi.fn(transport);
  const pool = { relay: vi.fn(() => ({ count })) };
  const service = createCountService(pool, { relays: [relay], ...options });
  services.push(service);
  return { service, count, pool };
}

it("loads lazily and shares zero and provenance across handles and observers", () => {
  const { service, count } = setup({}, () => of({ count: 0, approximate: true }));
  const note = service.event(target);
  expect(count).not.toHaveBeenCalled();
  const values: (number | undefined)[] = [];
  note.reactions$.subscribe((v) => values.push(v));
  service.event(target).reactions.refreshing.subscribe();
  const states: CountState[] = [];
  note.reactions.subscribe((s) => states.push(s));
  expect(values).toEqual([undefined, 0]);
  expect(states.at(-1)).toMatchObject({ value: 0, approximate: true, origin: { relay } });
  expect(count).toHaveBeenCalledOnce();
});

it("refreshes only while observed and returns stale data synchronously", () => {
  vi.useFakeTimers();
  const { service, count } = setup({ ttl: () => 1000 });
  const sub = service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(1000);
  expect(count).toHaveBeenCalledTimes(2);
  sub.unsubscribe();
  vi.advanceTimersByTime(5000);
  expect(count).toHaveBeenCalledTimes(2);
  const states: CountState[] = [];
  service.event(target).reactions.subscribe((s) => states.push(s));
  expect(states[0]).toMatchObject({ value: 5, fresh: false, refreshing: true });
  expect(count).toHaveBeenCalledTimes(3);
});

it.each([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.731, 0.8, 0.9, 1])(
  "preserves stale values and recovers after failures with jitter %s",
  (random) => {
    vi.useFakeTimers();
    const { service, count } = setup({ ttl: () => 1000, random: () => random });
    const values: (number | undefined)[] = [];
    const states: CountState[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    service.event(target).reactions.subscribe((s) => states.push(s));
    count.mockImplementation(() => throwError(() => Error("network")));
    vi.advanceTimersByTime(1000);
    expect(values).toEqual([undefined, 5]);
    expect(states.at(-1)).toMatchObject({ value: 5, fresh: false, refreshing: true, failure: undefined });
    count.mockImplementation(() => of({ count: 9 }));
    vi.advanceTimersByTime(60000);
    expect(values).toEqual([undefined, 5, 9]);
    expect(states.at(-1)).toMatchObject({ value: 9, fresh: true, refreshing: false });
  },
);

it("treats trusted relays as a normalized set and cancels removed endpoints", () => {
  vi.useFakeTimers();
  const routes = new BehaviorSubject([relay, "wss://B.test"]);
  const active = new Subject<{ count: number }>();
  const teardown = vi.fn();
  const { service, count } = setup(
    { relays: routes },
    () =>
      new Observable((s) => {
        const sub = active.subscribe(s);
        return () => {
          teardown();
          sub.unsubscribe();
        };
      }),
  );
  const values: (number | undefined)[] = [];
  service.event(target).reactions$.subscribe((v) => values.push(v));
  routes.next(["wss://b.test/", relay, relay]);
  expect(count).toHaveBeenCalledOnce();
  routes.next([relay]);
  expect(teardown).toHaveBeenCalledOnce();
  expect(count).toHaveBeenCalledTimes(2);
  active.next({ count: 7 });
  routes.next([]);
  expect(values.at(-1)).toBeUndefined();
  routes.next([relay]);
  expect(count).toHaveBeenCalledTimes(3);
});

it("shares capacity across services without stopping other services or the scheduler", () => {
  vi.useFakeTimers();
  const scheduler = createCountScheduler({ concurrency: 1 });
  const active = new Subject<{ count: number }>();
  const first = setup({ countScheduler: scheduler }, () => active);
  const second = setup({ countScheduler: scheduler }, () => active);
  first.service.event(target).reactions$.subscribe();
  second.service.event(target).reactions$.subscribe();
  expect(second.count).not.toHaveBeenCalled();
  first.service.stop();
  vi.advanceTimersByTime(0);
  expect(second.count).toHaveBeenCalledOnce();
  second.service.stop();
  let snapshot: unknown;
  scheduler.status$
    .subscribe((s) => {
      snapshot = s;
    })
    .unsubscribe();
  expect(snapshot).toMatchObject({ active: 0, requests: 0, relays: [] });
  scheduler.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("contains synchronous pool failures, retries with backoff, and cleans timers on stop", () => {
  vi.useFakeTimers();
  const { service, count } = setup({ random: () => 0.5 }, () => {
    throw Error("network");
  });
  const values: (number | undefined)[] = [];
  service.event(target).reactions$.subscribe((v) => values.push(v));
  vi.advanceTimersByTime(3000);
  expect(count).toHaveBeenCalledTimes(3);
  expect(values).toEqual([undefined]);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["throws", "unsupported", "empty"])("settles a %s metric without retry timers until invalidated", (mode) => {
  vi.useFakeTimers();
  const { service, count } = setup();
  const states: CountState[] = [];
  const filters = vi.fn<CountMetric["filters"]>(() => {
    if (mode === "throws") throw Error("filter");
    return mode === "empty" ? [] : undefined;
  });
  service
    .event(target)
    .metric({ id: "broken:v1", filters })
    .subscribe((s) => states.push(s));
  expect(states.at(-1)).toMatchObject({ value: undefined, fresh: false, refreshing: false });
  expect(states.at(-1)?.failure).toBeInstanceOf(Error);
  vi.advanceTimersByTime(120000);
  expect(filters).toHaveBeenCalledOnce();
  expect(count).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);

  filters.mockImplementation(() => [{ kinds: [7] }]);
  void service.invalidate(target);
  expect(filters).toHaveBeenCalledTimes(2);
  expect(states.at(-1)).toMatchObject({ value: 5, fresh: true, refreshing: false, failure: undefined });
});

it("shares synchronous reentrant subscriptions", () => {
  const { service, count } = setup();
  const subscriptions = new Subscription();
  subscriptions.add(
    service.event(target).reactions$.subscribe((v) => {
      if (v === undefined) subscriptions.add(service.event(target).reactions$.subscribe());
    }),
  );
  expect(count).toHaveBeenCalledOnce();
  subscriptions.unsubscribe();
});

it("bounds inactive retention and lets old handles rejoin canonical work", () => {
  const { service, count } = setup({ cacheCapacity: 2, ttl: () => Infinity });
  const old = service.event(target);
  old.reactions$.subscribe().unsubscribe();
  for (let i = 0; i < 100; i++)
    service
      .event({ ...target, id: String(i) })
      .reactions$.subscribe()
      .unsubscribe();
  const a = old.reactions$.subscribe();
  const b = service.event(target).reactions$.subscribe();
  expect(count).toHaveBeenCalledTimes(102);
  a.unsubscribe();
  b.unsubscribe();
});

it("waits indefinitely for initial relay configuration", () => {
  vi.useFakeTimers();
  const routes = new Subject<string[]>();
  const { service, count } = setup({ relays: routes });
  const states: CountState[] = [];
  service.event(target).reactions.subscribe((s) => states.push(s));
  vi.advanceTimersByTime(120000);
  expect(states.at(-1)).toMatchObject({ refreshing: true, value: undefined, failure: undefined });
  expect(vi.getTimerCount()).toBe(0);
  expect(count).not.toHaveBeenCalled();
  routes.next([relay]);
  expect(count).toHaveBeenCalledOnce();
  expect(states.at(-1)?.value).toBe(5);
});

it("supports virtual clocks, explicit invalidation, and infinite freshness", () => {
  const clock = new VirtualTimeScheduler(undefined, 5000);
  const { service, count } = setup({ scheduler: clock, ttl: () => Infinity });
  service.event({ ...target, created_at: Infinity }).reactions$.subscribe();
  clock.flush();
  expect(count).toHaveBeenCalledOnce();
  void service.invalidate(target);
  expect(count).toHaveBeenCalledTimes(2);
  service.stop();
  expect(clock.actions).toHaveLength(0);
});

it("keeps built-in metrics independent and permits versioned custom filters", () => {
  const { service, count } = setup();
  const handle = service.event(target);
  handle.reactions$.subscribe();
  handle.comments$.subscribe();
  handle.metric({ id: "quotes:v1", filters: (event) => [{ "#q": [event.id] }] }).subscribe();
  expect(count.mock.calls.map(([filters]) => filters)).toEqual([
    [{ kinds: [7], "#e": [target.id] }],
    [{ kinds: [1111], "#E": [target.id] }],
    [{ "#q": [target.id] }],
  ]);
});

it("cancels outstanding demand and all clock/list subscriptions on abort", () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const finalize = vi.fn();
  const routes = new Observable<readonly string[]>((s) => {
    s.next([relay]);
    return finalize;
  });
  const { service, count } = setup({ concurrency: 1, signal: controller.signal, relays: routes }, () => NEVER);
  service.event(target).reactions$.subscribe();
  service.event({ ...target, id: "b" }).reactions$.subscribe();
  controller.abort();
  expect(finalize).toHaveBeenCalledOnce();
  expect(count).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
  service.event({ ...target, id: "c" }).reactions$.subscribe();
  expect(count).toHaveBeenCalledOnce();
});
it.each([
  [-60, 60000],
  [0, 60000],
  [1799, 60000],
  [1800, 60000],
  [3599, 60000],
  [3600, 60000],
  [21599, 60000],
  [21600, 300000],
  [86399, 300000],
  [86400, 1800000],
  [604799, 1800000],
  [604800, 7200000],
  [2591999, 7200000],
  [2592000, 21600000],
  [365 * 86400, 21600000],
])("refreshes a target aged %s seconds after %s milliseconds by default", (age, interval) => {
  vi.useFakeTimers();
  const { service, count } = setup();
  const sub = service.event({ ...target, created_at: Date.now() / 1000 - age }).reactions$.subscribe();
  expect(count).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(interval - 1);
  expect(count).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(count).toHaveBeenCalledTimes(2);
  sub.unsubscribe();
  service.stop();
});

it("uses the older age bracket when scheduling after a refresh crosses a boundary", () => {
  vi.useFakeTimers();
  const { service, count } = setup();
  const sub = service.event({ ...target, created_at: Date.now() / 1000 - 21599 }).reactions$.subscribe();
  vi.advanceTimersByTime(60000);
  expect(count).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(299999);
  expect(count).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1);
  expect(count).toHaveBeenCalledTimes(3);
  sub.unsubscribe();
  service.stop();
});

it.each(["attemptTimeout", "cacheTimeout"] as const)(
  "rejects an overflowing %s when constructing the service",
  (key) => {
    expect(() => setup({ [key]: 500_000_000_000 })).toThrow(`${key} must be positive and at most 2147483647 ms`);
  },
);

it("keeps outstanding and active counts alive at the largest supported budgets", () => {
  vi.useFakeTimers();
  const replies = new Subject<{ count: number }>();
  const { service, count } = setup({ concurrency: 1, attemptTimeout: 2_147_483_647 }, () => replies);
  const first: (number | undefined)[] = [];
  const second: (number | undefined)[] = [];
  service.event(target).reactions$.subscribe((value) => first.push(value));
  service.event({ ...target, id: "b" }).reactions$.subscribe((value) => second.push(value));
  vi.advanceTimersByTime(100);
  expect(count).toHaveBeenCalledOnce();
  replies.next({ count: 7 });
  expect(first).toEqual([undefined, 7]);
  expect(count).toHaveBeenCalledTimes(2);
  replies.next({ count: 9 });
  expect(second).toEqual([undefined, 9]);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("shares and fulfills a thousand observed metrics without dropping excess demand", () => {
  vi.useFakeTimers();
  const diagnostic = vi.fn();
  const { service, count } = setup({ concurrency: 2, ttl: () => Infinity, diagnostic }, () =>
    timer(1).pipe(map(() => ({ count: 7 }))),
  );
  const subscriptions = new Subscription();
  const answered = vi.fn(),
    failed = vi.fn();
  for (let i = 0; i < 1000; i++) {
    const handle = service.event({ ...target, id: String(i) });
    subscriptions.add(
      handle.reactions$.subscribe({
        next: (value) => {
          if (value !== undefined) answered();
        },
        error: failed,
      }),
    );
    subscriptions.add(handle.reactions.refreshing.subscribe());
  }
  vi.advanceTimersByTime(1000);
  expect(answered).toHaveBeenCalledTimes(1000);
  expect(count).toHaveBeenCalledTimes(1000);
  expect(failed).not.toHaveBeenCalled();
  expect(diagnostic.mock.calls.some(([event]) => event.requests === 1000)).toBe(true);
  subscriptions.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

describe("persistent cache", () => {
  const target = { id: "a", kind: 1, created_at: 0 };
  const services: ReturnType<typeof createCountService>[] = [];
  afterEach(() => {
    services.splice(0).forEach((s) => s.stop());
    vi.useRealTimers();
  });
  const flush = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
  };
  function setup(cache: CountCache = new Keyv(), overrides: Partial<CountServiceOptions> = {}) {
    const policy = new BehaviorSubject("trusted");
    const source = { count: vi.fn(() => of({ count: 0 })) };
    const service = createCountService(
      { relay: () => source },
      {
        cache,
        relays: policy.pipe(map((value) => [`wss://${value}.test/`])),
        ttl: () => 5000,
        ...overrides,
      },
    );
    services.push(service);
    return { service, source, policy };
  }

  it("reuses a zero count across services without extending Keyv TTL", async () => {
    vi.useFakeTimers();
    const cache = new Keyv();
    const first = setup(cache);
    first.service.event(target).reactions$.subscribe();
    await flush();
    expect(first.source.count).toHaveBeenCalledTimes(1);
    first.service.stop();
    await vi.advanceTimersByTimeAsync(3000);
    const second = setup(cache);
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(second.source.count).not.toHaveBeenCalled();
    second.service.stop();
    await vi.advanceTimersByTimeAsync(2001);
    const third = setup(cache);
    third.service.event(target).reactions$.subscribe();
    await flush();
    expect(third.source.count).toHaveBeenCalledTimes(1);
  });

  it("emits retained stale counts and shares hydration across subscribers", async () => {
    vi.useFakeTimers();
    const cache = new Keyv();
    const first = setup(cache, { cacheRetention: 20000 });
    first.service.event(target).reactions$.subscribe();
    await flush();
    first.service.stop();
    await vi.advanceTimersByTimeAsync(6000);
    const second = setup(cache, { cacheRetention: 20000 });
    second.source.count = vi.fn(() => NEVER);
    const states: CountState[] = [];
    second.service.event(target).reactions.subscribe((s) => states.push(s));
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(states[0]).toMatchObject({ value: 0, fresh: false, refreshing: true });
    expect(second.source.count).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("invalidates entries from previous sessions (all=%s)", async (all) => {
    const cache = new Keyv();
    const first = setup(cache);
    first.service.event(target).reactions$.subscribe();
    await flush();
    first.service.stop();
    const second = setup(cache);
    await second.service.invalidate(all ? undefined : target);
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(second.source.count).toHaveBeenCalledTimes(1);
  });

  it("rejects counts accepted under a different policy", async () => {
    const cache = new Keyv();
    const first = setup(cache);
    first.service.event(target).reactions$.subscribe();
    await flush();
    first.service.stop();
    const second = setup(cache);
    second.policy.next("other");
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(second.source.count).toHaveBeenCalledTimes(1);
  });

  it("falls back after a cache timeout and cancels hydration on stop", async () => {
    vi.useFakeTimers();
    const cache: CountCache = { get: () => new Promise(() => {}), set: async () => true };
    const first = setup(cache);
    first.service.event(target).reactions$.subscribe();
    await vi.advanceTimersByTimeAsync(1001);
    expect(first.source.count).toHaveBeenCalledTimes(1);
    const second = setup(cache);
    second.service.event(target).reactions$.subscribe();
    second.service.stop();
    await vi.advanceTimersByTimeAsync(1001);
    expect(second.source.count).not.toHaveBeenCalled();
  });

  it("ignores malformed cache records and handles rejected reads", async () => {
    for (const get of [
      async () => ({ version: 1, state: { value: -1 } }),
      async () => {
        throw Error("offline");
      },
    ]) {
      const { service, source } = setup({ get, set: async () => true });
      service.event(target).reactions$.subscribe();
      await flush();
      expect(source.count).toHaveBeenCalledTimes(1);
    }
  });

  it("does not resurrect delayed writes after invalidation", async () => {
    const cache = new Keyv();
    const original = cache.set.bind(cache);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let delay = true;
    vi.spyOn(cache, "set").mockImplementation(async (key, value, ttl) => {
      if (typeof value === "object" && delay) {
        delay = false;
        await gate;
      }
      return original(key, value, ttl);
    });
    const first = setup(cache);
    first.service.event(target).reactions$.subscribe();
    await flush();
    const invalidated = first.service.invalidate(target);
    release();
    await invalidated;
    first.service.stop();
    await flush();
    const second = setup(cache);
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(first.source.count).toHaveBeenCalledTimes(1);
    expect(second.source.count).toHaveBeenCalledTimes(1);
  });

  it("keeps infinite TTL entries and invalidation markers even with a Keyv default TTL", async () => {
    vi.useFakeTimers();
    const cache = new Keyv({ ttl: 1000 });
    const first = setup(cache, { ttl: () => Infinity });
    first.service.event(target).reactions$.subscribe();
    await flush();
    first.service.stop();
    await vi.advanceTimersByTimeAsync(10000);
    const second = setup(cache, { ttl: () => Infinity });
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(second.source.count).not.toHaveBeenCalled();
    second.service.stop();
    await second.service.invalidate();
    await vi.advanceTimersByTimeAsync(10000);
    const third = setup(cache, { ttl: () => Infinity });
    third.service.event(target).reactions$.subscribe();
    await flush();
    expect(third.source.count).toHaveBeenCalledTimes(1);
  });

  it("honors shorter storage retention and original freshness when TTL configuration changes", async () => {
    vi.useFakeTimers();
    const cache = new Keyv();
    const first = setup(cache, { cacheRetention: 20000 });
    first.service.event(target).reactions$.subscribe();
    await flush();
    first.service.stop();
    await vi.advanceTimersByTimeAsync(3000);
    const second = setup(cache, { ttl: () => 60000 });
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(second.source.count).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(second.source.count).toHaveBeenCalledTimes(1);
    second.service.stop();
    const short = new Keyv();
    const third = setup(short, { cacheRetention: 1000 });
    third.service.event(target).reactions$.subscribe();
    await flush();
    third.service.stop();
    await vi.advanceTimersByTimeAsync(1001);
    const fourth = setup(short);
    fourth.service.event(target).reactions$.subscribe();
    await flush();
    expect(fourth.source.count).toHaveBeenCalledTimes(1);
  });

  it("keeps memory hits synchronous without reading storage again", async () => {
    const cache = new Keyv();
    const get = vi.spyOn(cache, "get");
    const { service, source } = setup(cache);
    const first = service.event(target).reactions$.subscribe();
    await flush();
    first.unsubscribe();
    get.mockClear();
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    expect(values).toEqual([0]);
    expect(get).not.toHaveBeenCalled();
    expect(source.count).toHaveBeenCalledTimes(1);
  });

  it("does not fetch after an abandoned cache read or persist a failed resolution", async () => {
    let release: (value: unknown) => void = () => {};
    const cache: CountCache = {
      get: vi.fn(
        () =>
          new Promise((r) => {
            release = r;
          }),
      ),
      set: vi.fn(async () => true),
    };
    const first = setup(cache);
    const sub = first.service.event(target).reactions$.subscribe();
    await flush();
    sub.unsubscribe();
    release(undefined);
    await flush();
    expect(first.source.count).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    const failureCache = new Keyv();
    const set = vi.spyOn(failureCache, "set");
    const second = setup(failureCache);
    second.source.count = vi.fn(() => {
      throw Error("network");
    });
    second.service.event(target).reactions$.subscribe();
    await flush();
    expect(set).not.toHaveBeenCalled();
    const third = setup(failureCache);
    third.service.event(target).reactions$.subscribe();
    await flush();
    expect(third.source.count).toHaveBeenCalledTimes(1);
  });

  it("tolerates rejected writes without losing the loaded count", async () => {
    const cache: CountCache = {
      get: async () => undefined,
      set: async () => {
        throw Error("disk full");
      },
    };
    const { service } = setup(cache);
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    await flush();
    expect(values).toEqual([undefined, 0]);
    await expect(service.invalidate()).rejects.toThrow("disk full");
  });

  it("does not block other metric reads behind a slow cache read", async () => {
    const cache = new Keyv();
    const get = cache.get.bind(cache);
    vi.spyOn(cache, "get").mockImplementation(async (key) => {
      if (key.includes("e:slow")) return new Promise(() => {});
      return get(key);
    });
    const { service, source } = setup(cache);
    service.event({ ...target, id: "slow" }).reactions$.subscribe();
    service.event(target).reactions$.subscribe();
    await flush();
    expect(source.count).toHaveBeenCalledTimes(1);
  });

  it("does not clear unrelated cache keys when invalidating all counts", async () => {
    const cache = new Keyv();
    await cache.set("other-feature", 42);
    const { service } = setup(cache);
    await service.invalidate();
    expect(await cache.get("other-feature")).toBe(42);
  });

  it("bounds cache reads even while earlier writes are stalled", async () => {
    vi.useFakeTimers();
    const keyv = new Keyv();
    const cache: CountCache = { get: (key) => keyv.get(key), set: () => new Promise(() => {}) };
    const { service, source } = setup(cache);
    service.event(target).reactions$.subscribe();
    service.event({ ...target, id: "b" }).reactions$.subscribe();
    await flush();
    expect(source.count).toHaveBeenCalledTimes(2);
    service.event({ ...target, id: "c" }).reactions$.subscribe();
    await vi.advanceTimersByTimeAsync(1001);
    expect(source.count).toHaveBeenCalledTimes(3);
  });

  it("retains counts for 24 hours by default without extending retention on hydration", async () => {
    vi.useFakeTimers();
    const cache = new Keyv();
    const first = setup(cache);
    first.service.event(target).reactions$.subscribe();
    await flush();
    first.service.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    const second = setup(cache);
    second.source.count = vi.fn(() => NEVER);
    const restored: CountState[] = [];
    second.service.event(target).reactions.subscribe((s) => restored.push(s));
    await flush();
    expect(restored[0]).toMatchObject({ value: 0, fresh: false, refreshing: true });
    expect(second.source.count).toHaveBeenCalledTimes(1);
    second.service.stop();
    await vi.advanceTimersByTimeAsync(23 * 60 * 60_000 + 1);
    const third = setup(cache);
    third.source.count = vi.fn(() => NEVER);
    const expired: CountState[] = [];
    third.service.event(target).reactions.subscribe((s) => expired.push(s));
    await flush();
    expect(expired[0]).toMatchObject({ value: undefined, fresh: false, refreshing: true });
    expect(third.source.count).toHaveBeenCalledTimes(1);
  });
});

describe("RelayPool integration", () => {
  const pools: RelayPool[] = [];
  afterEach(() => {
    pools.forEach((pool) => pool.relays.forEach((relay) => relay.close()));
    pools.length = 0;
    WS.clean();
    vi.restoreAllMocks();
  });

  it("adapts actual RelayPool COUNT outcomes from a controlled websocket", async () => {
    vi.spyOn(Relay, "fetchInformationDocument").mockResolvedValue(null);
    const server = new WS("wss://count.test/", { jsonProtocol: true });
    const pool = new RelayPool();
    pools.push(pool);
    const counts = createCountService(pool, { relays: ["wss://count.test/"] });
    const result = firstValueFrom(
      counts.event({ id: "a".repeat(64), kind: 1, created_at: 0 }).reactions$.pipe(filter((v) => v !== undefined)),
    );
    await server.connected;
    const message = (await server.nextMessage) as [string, string, unknown];
    expect(message[0]).toBe("COUNT");
    expect(message[2]).toEqual({ kinds: [7], "#e": ["a".repeat(64)] });
    server.send(["COUNT", message[1], { count: 0, approximate: true }]);
    expect(await result).toBe(0);
    counts.stop();
  });
});
