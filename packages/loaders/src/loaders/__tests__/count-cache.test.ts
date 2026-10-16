import Keyv from "keyv";
import { afterEach, expect, it, vi } from "vitest";
import { BehaviorSubject, NEVER, of } from "rxjs";
import { createCountService, type CountCache, type CountSource, type CountState } from "../index.js";

const target = { id: "a", kind: 1, created_at: 0 };
const services: ReturnType<typeof createCountService>[] = [];
afterEach(() => {
  services.splice(0).forEach((s) => s.stop());
  vi.useRealTimers();
});
const flush = async () => {
  for (let i = 0; i < 100; i++) await Promise.resolve();
};
function setup(cache: CountCache = new Keyv(), overrides: Parameters<typeof createCountService>[0] = {}) {
  const policy = new BehaviorSubject("trusted");
  const source: CountSource = {
    id: "test",
    policy: () => policy,
    count: vi.fn((q) => of({ value: 0, metric: q.metric.id, origin: { adapter: "test", relay: "wss://test/" } })),
  };
  const service = createCountService({ cache, sources: [source], ttl: () => 5000, ...overrides });
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
