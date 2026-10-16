import { afterEach, describe, expect, it, vi } from "vitest";
import { BehaviorSubject, defer, EMPTY, map, Observable, of, Subject, timer, VirtualTimeScheduler } from "rxjs";
import { createCountService, fallbackCountSource, relayCountSource } from "../index.js";
import type { CountRequest, CountSource, CountState } from "../index.js";

const target = { id: "a".repeat(64), kind: 1, created_at: 0 };
const relay = "wss://relay.test/";
const source = (value = 0): CountSource => ({
  id: "test",
  policy: () => of("test"),
  count: (q) => of({ value, metric: q.metric.id, origin: { adapter: "test", relay } }),
});
afterEach(() => vi.useRealTimers());

describe("count service", () => {
  it("loads lazily, shares across handles and metadata, and treats zero as success", () => {
    const first = source();
    first.count = vi.fn(first.count);
    const fallback = source(99);
    fallback.id = "other";
    fallback.count = vi.fn(fallback.count);
    const service = createCountService({ sources: [first, fallback] });
    const note = service.event(target);
    expect(first.count).not.toHaveBeenCalled();
    const values: (number | undefined)[] = [];
    const a = note.reactions$.subscribe((v) => values.push(v));
    const b = service.event(target).reactions.refreshing.subscribe();
    expect(values).toEqual([undefined, 0]);
    expect(first.count).toHaveBeenCalledTimes(1);
    expect(fallback.count).not.toHaveBeenCalled();
    a.unsubscribe();
    b.unsubscribe();
    service.stop();
  });

  it("refreshes only while observed and emits stale cache synchronously on return", () => {
    vi.useFakeTimers();
    const s = source(5);
    s.count = vi.fn(s.count);
    const service = createCountService({ sources: [s], ttl: () => 1000 });
    const handle = service.event(target);
    const a = handle.reactions$.subscribe();
    vi.advanceTimersByTime(1000);
    expect(s.count).toHaveBeenCalledTimes(2);
    a.unsubscribe();
    vi.advanceTimersByTime(5000);
    expect(s.count).toHaveBeenCalledTimes(2);
    const states: CountState[] = [];
    const b = handle.reactions.subscribe((state) => states.push(state));
    expect(states[0]).toMatchObject({ value: 5, fresh: false, refreshing: true });
    expect(s.count).toHaveBeenCalledTimes(3);
    b.unsubscribe();
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retracts abandoned queue entries before transport admission", () => {
    vi.useFakeTimers();
    const starts: string[] = [];
    const count: CountRequest = (_relays, filters) =>
      defer(() => {
        starts.push(filters[0]["#e"]![0]);
        return new Subject();
      });
    const service = createCountService({ sources: [relayCountSource({ relays: [relay], count })], concurrency: 1 });
    const a = service.event(target).reactions$.subscribe();
    vi.advanceTimersByTime(0);
    const b = service.event({ ...target, id: "b" }).reactions$.subscribe();
    b.unsubscribe();
    a.unsubscribe();
    expect(starts).toEqual([target.id]);
    service.stop();
  });

  it("cancels running work and revokes a cached value on relay policy changes", () => {
    vi.useFakeTimers();
    const routes = new BehaviorSubject([relay]);
    const count: CountRequest = () => of({ [relay]: { ok: true, value: { count: 12 } } });
    const service = createCountService({ sources: [relayCountSource({ relays: routes, count })] });
    const values: (number | undefined)[] = [];
    const sub = service.event(target).reactions$.subscribe((value) => values.push(value));
    vi.advanceTimersByTime(0);
    routes.next([]);
    expect(values).toEqual([undefined, 12, undefined]);
    routes.next([relay]);
    vi.advanceTimersByTime(0);
    expect(values.at(-1)).toBe(12);
    sub.unsubscribe();
    service.stop();
  });

  it("keeps observing a preferred source after a fallback succeeds", () => {
    const policy = new BehaviorSubject("empty");
    const preferred: CountSource = {
      id: "preferred",
      policy: () => policy,
      count: (q) =>
        policy.value === "empty"
          ? EMPTY
          : of({ value: 9, metric: q.metric.id, origin: { adapter: "preferred", relay } }),
    };
    const service = createCountService({ sources: [fallbackCountSource([preferred, source(2)])] });
    const values: (number | undefined)[] = [];
    const sub = service.event(target).reactions$.subscribe((v) => values.push(v));
    expect(values.at(-1)).toBe(2);
    policy.next("ready");
    expect(values.at(-1)).toBe(9);
    sub.unsubscribe();
    service.stop();
  });

  it("retries failures without fabricating zero and stops all timers", () => {
    vi.useFakeTimers();
    const s = source();
    s.count = vi.fn(() => EMPTY);
    const service = createCountService({ sources: [s], retryDelay: 1000, random: () => 0.5 });
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    vi.advanceTimersByTime(3000);
    expect(s.count).toHaveBeenCalledTimes(3);
    expect(values).toEqual([undefined]);
    service.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("shares synchronous reentrant subscriptions", () => {
    const s = source();
    s.count = vi.fn(s.count);
    const service = createCountService({ sources: [s] });
    const subscriptions: { unsubscribe(): void }[] = [];
    let once = false;
    subscriptions.push(
      service.event(target).reactions$.subscribe(() => {
        if (!once) {
          once = true;
          subscriptions.push(service.event(target).reactions$.subscribe());
        }
      }),
    );
    expect(s.count).toHaveBeenCalledTimes(1);
    subscriptions.forEach((sub) => sub.unsubscribe());
    service.stop();
  });

  it("retains stale values after refresh failure and emits unchanged numbers once", () => {
    vi.useFakeTimers();
    let calls = 0;
    const s = source(3);
    const original = s.count;
    s.count = (q, c) => (++calls === 1 ? original(q, c) : EMPTY);
    const service = createCountService({ sources: [s], ttl: () => 1000 });
    const values: (number | undefined)[] = [];
    service.event(target).reactions$.subscribe((v) => values.push(v));
    vi.advanceTimersByTime(1000);
    expect(values).toEqual([undefined, 3]);
    service.stop();
  });

  it("bounds actual transport concurrency through nested fallbacks", () => {
    vi.useFakeTimers();
    let active = 0;
    let peak = 0;
    const count: CountRequest = () =>
      new Observable((sub) => {
        peak = Math.max(peak, ++active);
        const timerSub = timer(150)
          .pipe(map(() => ({ [relay]: { ok: true as const, value: { count: 1 } } })))
          .subscribe(sub);
        return () => {
          active--;
          timerSub.unsubscribe();
        };
      });
    const service = createCountService({
      sources: [fallbackCountSource([relayCountSource({ relays: [relay], count })])],
      concurrency: 8,
      perRelay: 8,
    });
    const values: number[] = [];
    for (let i = 0; i < 60; i++)
      service.event({ ...target, id: String(i) }).reactions$.subscribe((v) => {
        if (v !== undefined) values.push(v);
      });
    vi.advanceTimersByTime(1300);
    expect(values).toHaveLength(60);
    expect(peak).toBeLessThanOrEqual(8);
    service.stop();
    expect(active).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("evicts inactive cache entries while old handles rejoin canonical active streams", () => {
  const s = source(6);
  s.count = vi.fn(s.count);
  let last = { cacheEntries: 0, activeMetrics: 0 };
  const service = createCountService({
    sources: [s],
    cacheCapacity: 1,
    diagnostic: (event) => {
      last = event;
    },
  });
  const old = service.event(target);
  const a = old.reactions$.subscribe();
  a.unsubscribe();
  const b = service.event({ ...target, id: "b" }).reactions$.subscribe();
  b.unsubscribe();
  expect(last.cacheEntries).toBe(1);
  expect(last.activeMetrics).toBe(0);
  const c = old.reactions$.subscribe();
  const d = service.event(target).reactions.refreshing.subscribe();
  expect(s.count).toHaveBeenCalledTimes(3);
  c.unsubscribe();
  d.unsubscribe();
  service.stop();
});

it("waits a bounded time for initial configuration but observes later emissions", () => {
  vi.useFakeTimers();
  const routes = new Subject<readonly string[]>();
  const count: CountRequest = () => of({ [relay]: { ok: true, value: { count: 4 } } });
  const service = createCountService({
    sources: [relayCountSource({ relays: routes, count }), source(1)],
    attemptTimeout: 100,
  });
  const values: (number | undefined)[] = [];
  service.event(target).reactions$.subscribe((v) => values.push(v));
  vi.advanceTimersByTime(201);
  expect(values.at(-1)).toBe(1);
  routes.next([relay]);
  vi.advanceTimersByTime(0);
  expect(values.at(-1)).toBe(4);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("handles future targets and infinite successful TTLs without refresh loops", () => {
  vi.useFakeTimers();
  const s = source(1);
  s.count = vi.fn(s.count);
  const ages: number[] = [];
  const service = createCountService({
    sources: [s],
    ttl: ({ age }) => {
      ages.push(age);
      return Infinity;
    },
  });
  service.event({ ...target, created_at: Date.now() / 1000 + 1000 }).reactions$.subscribe();
  vi.advanceTimersByTime(1000000);
  expect(s.count).toHaveBeenCalledTimes(1);
  expect(ages.every((age) => age === 0)).toBe(true);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("invalidates observed targets and ignores late callbacks from cancelled generations", () => {
  let completed = 0;
  const s = source(1);
  const original = s.count;
  s.count = (q, c) => (++completed === 1 ? new Subject() : original(q, c));
  const service = createCountService({ sources: [s] });
  const values: (number | undefined)[] = [];
  service.event(target).reactions$.subscribe((v) => values.push(v));
  service.invalidate(target);
  expect(values.at(-1)).toBe(1);
  service.stop();
  expect(completed).toBe(2);
});

it.each([50, 150, 500])("resolves a stable cold viewport within its derived %i ms transport budget", (latency) => {
  vi.useFakeTimers();
  const count: CountRequest = () =>
    timer(latency).pipe(map(() => ({ [relay]: { ok: true as const, value: { count: 1 } } })));
  const service = createCountService({
    sources: [relayCountSource({ relays: [relay], count })],
    concurrency: 8,
    perRelay: 8,
    resolutionTimeout: 30000,
    attemptTimeout: 30000,
  });
  let resolved = 0;
  for (let i = 0; i < 60; i++)
    service.event({ ...target, id: String(i) }).reactions$.subscribe((value) => {
      if (value !== undefined) resolved++;
    });
  vi.advanceTimersByTime(Math.ceil(60 / 8) * latency + 100);
  expect(resolved).toBe(60);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("absorbs synchronous mount probes without opening transports", () => {
  vi.useFakeTimers();
  const count = vi.fn<CountRequest>(() => new Subject());
  const service = createCountService({ sources: [relayCountSource({ relays: [relay], count })] });
  for (let i = 0; i < 2000; i++)
    service
      .event({ ...target, id: String(i) })
      .reactions$.subscribe()
      .unsubscribe();
  expect(count).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  service.stop();
});

it("keeps inactive retention bounded across thousands of successful lifecycles", () => {
  const s = source(4);
  let peak = 0;
  const service = createCountService({
    sources: [s],
    cacheCapacity: 64,
    diagnostic: (event) => {
      peak = Math.max(peak, event.cacheEntries);
      if (event.type === "released") {
        expect(event.cacheEntries).toBeLessThanOrEqual(64);
        expect(event.activeMetrics).toBe(0);
      }
    },
  });
  for (let i = 0; i < 2000; i++)
    service
      .event({ ...target, id: String(i) })
      .reactions$.subscribe()
      .unsubscribe();
  expect(peak).toBeLessThanOrEqual(65);
  service.stop();
});

it.each([0, 10])("measures work avoided by a %i ms admission window", (admissionWindow) => {
  vi.useFakeTimers();
  const count = vi.fn<CountRequest>(() => new Subject());
  const service = createCountService({ sources: [relayCountSource({ relays: [relay], count })], admissionWindow });
  for (let i = 0; i < 100; i++) {
    const sub = service.event({ ...target, id: String(i) }).reactions$.subscribe();
    vi.advanceTimersByTime(5);
    sub.unsubscribe();
  }
  expect(count).toHaveBeenCalledTimes(admissionWindow === 0 ? 100 : 0);
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("retains missing-result cooldowns across unmounts without keeping timers alive", () => {
  vi.useFakeTimers();
  const s = source();
  s.count = vi.fn(() => EMPTY);
  const service = createCountService({ sources: [s], retryDelay: 1000, random: () => 0.5 });
  service.event(target).reactions$.subscribe().unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
  const sub = service.event(target).reactions$.subscribe();
  expect(s.count).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1000);
  expect(s.count).toHaveBeenCalledTimes(2);
  sub.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("uses an injected virtual scheduler for active TTL refresh and teardown", () => {
  const scheduler = new VirtualTimeScheduler(undefined, 2100);
  const s = source(2);
  s.count = vi.fn(s.count);
  const service = createCountService({ sources: [s], scheduler, ttl: () => 1000 });
  service.event(target).reactions$.subscribe();
  scheduler.flush();
  expect(s.count).toHaveBeenCalledTimes(3);
  service.stop();
  expect(scheduler.actions).toHaveLength(0);
});

it("retains completed configuration lists across ref-counted reconnects", () => {
  vi.useFakeTimers();
  const routes = new BehaviorSubject([relay]);
  const count = vi.fn<CountRequest>(() => of({ [relay]: { ok: true, value: { count: 8 } } }));
  const service = createCountService({ sources: [relayCountSource({ relays: routes, count })] });
  const first = service.event(target).reactions$.subscribe();
  vi.advanceTimersByTime(1);
  routes.complete();
  first.unsubscribe();
  const values: (number | undefined)[] = [];
  const second = service.event(target).reactions$.subscribe((value) => values.push(value));
  expect(values).toEqual([8]);
  expect(count).toHaveBeenCalledTimes(1);
  second.unsubscribe();
  service.stop();
  expect(vi.getTimerCount()).toBe(0);
});
