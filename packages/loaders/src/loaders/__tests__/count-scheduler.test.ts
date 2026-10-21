import { afterEach, expect, it, vi } from "vitest";
import { defer, EMPTY, NEVER, Observable, of, Subject, Subscription, throwError, timer, map } from "rxjs";
import type { Relay, RelayCountOptions, RelayCountResponse } from "applesauce-relay";
import { createCountScheduler, type CountSchedulerOptions, type CountSchedulerStatus } from "../count-scheduler.js";

const urls = ["wss://a.test/", "wss://b.test/"];
const budget = { attemptTimeout: 5000 };
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((f) => f());
  vi.useRealTimers();
});
function setup(
  transport: (url: string, options?: RelayCountOptions) => Observable<RelayCountResponse>,
  options: CountSchedulerOptions = {},
) {
  const scheduler = createCountScheduler({ random: () => 0.5, ...options });
  cleanups.push(() => scheduler.stop());
  const release = scheduler.retain(urls);
  cleanups.push(release);
  let snapshot: CountSchedulerStatus;
  scheduler.status$.subscribe((s) => {
    snapshot = s;
  });
  const count = vi.fn((url: string) => ({ count: ((_filters, _id, opts) => transport(url, opts)) as Relay["count"] }));
  const request = (relays = urls, requestOptions = budget) =>
    scheduler.count({ relay: count }, relays, [{}], requestOptions);
  return { scheduler, count, request, state: () => snapshot! };
}
const error = (name: string, reason?: string) => Object.assign(new Error(reason ?? name), { name, reason });

it("reserves slots atomically and chooses an available alternative", () => {
  const { request, count, state } = setup(() => NEVER, { concurrency: 1 });
  const a = request([urls[0]]).subscribe();
  const waiting = request([urls[0]]).subscribe();
  const b = request().subscribe();
  expect(count.mock.calls.map(([url]) => url)).toEqual(urls);
  expect(state()).toMatchObject({ active: 2, requests: 3 });
  waiting.unsubscribe();
  a.unsubscribe();
  b.unsubscribe();
  expect(state()).toMatchObject({ active: 0, requests: 0 });
});

it("keeps a thousand subscriptions outstanding and eventually fulfills every one", () => {
  vi.useFakeTimers();
  const { request, state } = setup(
    (_url, options) =>
      defer(() => {
        options?.onSent?.();
        return timer(20).pipe(map(() => ({ count: 1 })));
      }),
    { concurrency: 2 },
  );
  const completed = vi.fn();
  const failed = vi.fn();
  for (let i = 0; i < 1000; i++) request([urls[0]]).subscribe({ next: completed, error: failed });
  expect(state()).toMatchObject({ active: 2, requests: 1000 });
  vi.advanceTimersByTime(11000);
  expect(completed).toHaveBeenCalledTimes(1000);
  expect(failed).not.toHaveBeenCalled();
  expect(state()).toMatchObject({ active: 0, requests: 0 });
  expect(vi.getTimerCount()).toBe(0);
});

it("keeps waiting observers alive without allocating a timer for each subscription", () => {
  vi.useFakeTimers();
  const response = new Subject<RelayCountResponse>();
  const { request, state } = setup(() => response, { concurrency: 1 });
  const subscriptions = new Subscription();
  for (let i = 0; i < 1000; i++) subscriptions.add(request([urls[0]]).subscribe());
  expect(state()).toMatchObject({ active: 1, requests: 1000 });
  expect(vi.getTimerCount()).toBe(1); // Only the active attempt has a deadline.
  subscriptions.unsubscribe();
  expect(state()).toMatchObject({ active: 0, requests: 0 });
  expect(vi.getTimerCount()).toBe(0);
});

it("isolates synchronous errors and malformed answers while keeping demand alive", () => {
  const { request, count } = setup((url) => {
    if (url === urls[0]) throw Error("network");
    return of({ count: -1 });
  });
  const failure = vi.fn();
  request().subscribe({ error: failure });
  expect(count).toHaveBeenCalledTimes(2);
  expect(failure).not.toHaveBeenCalled();
});

it("retries a relay error without an error value instead of stranding demand", () => {
  const { request, count } = setup((url) => (url === urls[0] ? throwError(() => undefined) : of({ count: 3 })));
  const next = vi.fn();
  request().subscribe(next);
  expect(next).toHaveBeenCalledExactlyOnceWith({ relay: urls[1], response: { count: 3 } });
  expect(count).toHaveBeenCalledTimes(2);
});

it("advances after empty responses and accepts zero without summing results", () => {
  const { request, count } = setup((url) => (url === urls[0] ? EMPTY : of({ count: 0, approximate: true })));
  const next = vi.fn();
  request().subscribe(next);
  expect(next).toHaveBeenCalledExactlyOnceWith({ relay: urls[1], response: { count: 0, approximate: true } });
  expect(count).toHaveBeenCalledTimes(2);
});

it("tears down actual upstream work before reentrant reuse of capacity", () => {
  const active = new Subject<RelayCountResponse>();
  let concurrent = 0,
    peak = 0;
  const { request } = setup(
    () =>
      new Observable((s) => {
        peak = Math.max(peak, ++concurrent);
        const sub = active.subscribe(s);
        return () => {
          concurrent--;
          sub.unsubscribe();
        };
      }),
    { concurrency: 1 },
  );
  const subscriptions = new Subscription();
  subscriptions.add(request([urls[0]]).subscribe(() => subscriptions.add(request([urls[0]]).subscribe())));
  active.next({ count: 1 });
  expect(peak).toBe(1);
  expect(concurrent).toBe(1);
  subscriptions.unsubscribe();
  expect(concurrent).toBe(0);
});

it.each(["answer", "empty", "malformed", "error"])(
  "releases synchronous %s transports before dispatching more work",
  (outcome) => {
    let active = 0;
    let peak = 0;
    const { request, state } = setup(
      (url) =>
        new Observable((subscriber) => {
          peak = Math.max(peak, ++active);
          if (url === urls[1] || outcome === "answer") subscriber.next({ count: 1 });
          else if (outcome === "malformed") subscriber.next({ count: -1 });
          else if (outcome === "error") subscriber.error(Error("network"));
          subscriber.complete();
          return () => {
            active--;
          };
        }),
      { concurrency: 1 },
    );
    const answered = vi.fn();
    request().subscribe((value) => {
      answered(value);
      if (answered.mock.calls.length === 1) request().subscribe(answered);
    });
    expect(answered).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
    expect(active).toBe(0);
    expect(state()).toMatchObject({ active: 0, requests: 0 });
  },
);

it("does not send work cancelled reentrantly from dispatch instrumentation", () => {
  const scheduler = createCountScheduler();
  const release = scheduler.retain(urls);
  const count = vi.fn(() => of({ count: 0 }));
  scheduler
    .count({ relay: () => ({ count }) }, urls, [{}], {
      ...budget,
      diagnostic: (type) => {
        if (type === "dispatched") scheduler.stop();
      },
    })
    .subscribe();
  expect(count).not.toHaveBeenCalled();
  release();
});

it("dispatches to a free relay while other requests remain outstanding", () => {
  const { request, count } = setup(() => NEVER, { concurrency: 1 });
  const a = request([urls[0]]).subscribe();
  const waiting = request([urls[0]]).subscribe();
  const b = request([urls[1]]).subscribe();
  expect(count.mock.calls.map(([url]) => url)).toEqual(urls);
  waiting.unsubscribe();
  a.unsubscribe();
  b.unsubscribe();
});

it("bounds stale-relay exploration under continuing demand", () => {
  vi.useFakeTimers();
  const seen: string[] = [];
  const { request } = setup((url, options) => {
    seen.push(url);
    options?.onSent?.();
    return timer(url === urls[0] ? 5 : 500).pipe(map(() => ({ count: 1 })));
  });
  request([urls[0]]).subscribe();
  request([urls[1]]).subscribe();
  vi.advanceTimersByTime(500);
  vi.advanceTimersByTime(31000);
  seen.length = 0;
  for (let i = 0; i < 32; i++) {
    request().subscribe();
    vi.advanceTimersByTime(10);
  }
  expect(seen.filter((url) => url === urls[1])).toHaveLength(1);
});

it("coalesces failures from a burst into a single backoff episode", () => {
  vi.useFakeTimers();
  const replies: Subject<RelayCountResponse>[] = [];
  const { request, state } = setup(() => {
    const response = new Subject<RelayCountResponse>();
    replies.push(response);
    return response;
  });
  request([urls[0]]).subscribe({ error: () => {} });
  request([urls[0]]).subscribe({ error: () => {} });
  replies[0].error(error("RelayClosedError", "rate-limited: busy"));
  vi.advanceTimersByTime(50);
  replies[1].error(error("RelayClosedError", "rate-limited: busy"));
  expect(state().relays[0]).toMatchObject({ limit: 4, cooldownUntil: Date.now() + 950 });
});

it("does not treat high fixed latency as congestion and excludes readiness from samples", () => {
  vi.useFakeTimers();
  const { request, state } = setup(
    (_url, opts) =>
      new Observable((s) => {
        const sent = setTimeout(() => opts?.onSent?.(), 800);
        const reply = setTimeout(() => {
          s.next({ count: 1 });
          s.complete();
        }, 1000);
        return () => {
          clearTimeout(sent);
          clearTimeout(reply);
        };
      }),
  );
  for (let i = 0; i < 6; i++) {
    request([urls[0]]).subscribe();
    vi.advanceTimersByTime(1000);
  }
  expect(state().relays[0]).toMatchObject({
    latency: 200,
    baseline: expect.any(Number),
    limit: 8,
    cooldownUntil: 0,
    samples: 6,
  });
});

it("keeps admission when wire latency rises", () => {
  vi.useFakeTimers();
  let latency = 20;
  const { request, state } = setup((_url, opts) =>
    defer(() => {
      opts?.onSent?.();
      return timer(latency).pipe(map(() => ({ count: 1 })));
    }),
  );
  for (let i = 0; i < 6; i++) {
    request([urls[0]]).subscribe();
    vi.advanceTimersByTime(100);
  }
  expect(state().relays[0].limit).toBe(8);
  latency = 200;
  const a = request([urls[0]]).subscribe();
  const b = request([urls[0]]).subscribe();
  vi.advanceTimersByTime(200);
  expect(state().relays[0]).toMatchObject({ limit: 8, cooldownUntil: 0 });
  a.unsubscribe();
  b.unsubscribe();
});

it("coalesces a burst of rate limits and ignores successes from the previous generation", () => {
  vi.useFakeTimers();
  const replies: Subject<RelayCountResponse>[] = [];
  const { request, state } = setup(() => {
    const s = new Subject<RelayCountResponse>();
    replies.push(s);
    return s;
  });
  request([urls[0]]).subscribe({ error: () => {} });
  request([urls[0]]).subscribe({ error: () => {} });
  replies[0].error(error("RelayClosedError", "rate-limited: slow down"));
  const until = state().relays[0].cooldownUntil;
  replies[1].next({ count: 1 });
  expect(state().relays[0]).toMatchObject({ limit: 4, cooldownUntil: until, failure: "rate-limit" });
  const probe = request([urls[0]]).subscribe({ error: () => {} });
  vi.advanceTimersByTime(999);
  expect(replies).toHaveLength(2);
  vi.advanceTimersByTime(1);
  // The retried demand and the probe both fit in the halved limit
  expect(replies).toHaveLength(4);
  probe.unsubscribe();
});

it.each([
  ["AuthTimeoutError", undefined, "auth"],
  ["RelayClosedError", "unsupported: COUNT", "unsupported"],
  ["RelayClosedError", "invalid: filter", "invalid-query"],
  ["RelayCountResponseError", undefined, "malformed"],
  ["RelayConnectionError", undefined, "transport"],
  ["RelayClosedError", "rate-limited: busy", "rate-limit"],
])("classifies %s %s separately as %s", (name, reason, category) => {
  vi.useFakeTimers();
  const failure = error(name, reason);
  const { request, state } = setup(() => throwError(() => failure));
  request([urls[0]]).subscribe({ error: () => {} });
  expect(state().relays[0].failure).toBe(category === "invalid-query" ? undefined : category);
  expect(state().relays[0].limit).toBe(category === "transport" || category === "rate-limit" ? 4 : 8);
  if (category === "invalid-query") expect(state().relays[0].cooldownUntil).toBe(0);
});

it("forgets removed records, cancels cooldowns, and stops all outstanding and running work", () => {
  vi.useFakeTimers();
  const scheduler = createCountScheduler({ concurrency: 1 });
  const release = scheduler.retain([urls[0]]);
  let state: CountSchedulerStatus;
  scheduler.status$.subscribe((s) => {
    state = s;
  });
  const pool = { relay: () => ({ count: () => NEVER }) };
  scheduler.count(pool, [urls[0]], [{}], budget).subscribe();
  scheduler.count(pool, [urls[0]], [{}], budget).subscribe();
  release();
  scheduler.stop();
  expect(state!).toMatchObject({ active: 0, requests: 0, relays: [] });
  expect(vi.getTimerCount()).toBe(0);
});

it("refreshes stale latency baselines instead of treating a route change as congestion", () => {
  vi.useFakeTimers();
  let latency = 20;
  const { request, state } = setup((_url, opts) =>
    defer(() => {
      opts?.onSent?.();
      return timer(latency).pipe(map(() => ({ count: 1 })));
    }),
  );
  for (let i = 0; i < 6; i++) {
    request([urls[0]]).subscribe();
    vi.advanceTimersByTime(100);
  }
  vi.advanceTimersByTime(31_000);
  latency = 200;
  request([urls[0]]).subscribe();
  vi.advanceTimersByTime(200);
  expect(state().relays[0]).toMatchObject({ baseline: 200, latency: 200, limit: 8, cooldownUntil: 0 });
});

it("grows under sustained demand while keeping every new admission within its effective limit", () => {
  vi.useFakeTimers();
  const { request, state } = setup(
    (_url, options) => {
      const record = state().relays[0];
      expect(record.active).toBeLessThanOrEqual(record.limit);
      expect(record.active).toBeLessThanOrEqual(record.maximum);
      options?.onSent?.();
      return timer(20).pipe(map(() => ({ count: 1 })));
    },
    { concurrency: 64 },
  );
  for (let i = 0; i < 500; i++) request([urls[0]]).subscribe();
  vi.advanceTimersByTime(2000);
  expect(state()).toMatchObject({ active: 0, requests: 0 });
  expect(state().relays[0].limit).toBe(64);
});

it("grows linearly instead of doubling after a congestion signal", () => {
  vi.useFakeTimers();
  let limited = true;
  const { request, state } = setup(
    (_url, options) => {
      if (limited) {
        limited = false;
        return throwError(() => error("RelayClosedError", "rate-limited: busy"));
      }
      options?.onSent?.();
      return timer(20).pipe(map(() => ({ count: 1 })));
    },
    { concurrency: 64 },
  );
  request([urls[0]]).subscribe();
  expect(state().relays[0].limit).toBe(4);
  vi.advanceTimersByTime(2000);
  for (let i = 0; i < 100; i++) request([urls[0]]).subscribe();
  vi.advanceTimersByTime(100);
  expect(state().relays[0].limit).toBe(5);
});

it("ranks a timed out relay lower without reducing admission or cooling it down", () => {
  vi.useFakeTimers();
  const seen: string[] = [];
  const { request, state } = setup((url, options) => {
    seen.push(url);
    if (url === urls[0]) return NEVER;
    options?.onSent?.();
    return timer(20).pipe(map(() => ({ count: 1 })));
  });
  request([urls[1]]).subscribe();
  vi.advanceTimersByTime(20);
  request([urls[0]]).subscribe();
  vi.advanceTimersByTime(5000);
  expect(state().relays.find((r) => r.relay === urls[0])).toMatchObject({
    failure: "timeout",
    limit: 8,
    cooldownUntil: 0,
    latency: 5000,
  });
  seen.length = 0;
  request().subscribe();
  expect(seen).toEqual([urls[1]]);
});

it("rejects an overflowing attempt budget before admitting work", () => {
  const { request, count, state } = setup(() => NEVER);
  const failure = vi.fn();
  request(urls, { attemptTimeout: 500_000_000_000 }).subscribe({ error: failure });
  expect(failure).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: expect.stringContaining("attemptTimeout") }),
  );
  expect(count).not.toHaveBeenCalled();
  expect(state()).toMatchObject({ active: 0, requests: 0 });
});

it("retries outages until recovery without ending the logical subscription", () => {
  vi.useFakeTimers();
  let available = false;
  const { request, state } = setup((_url, options) => {
    options?.onSent?.();
    return available ? of({ count: 9 }) : throwError(() => error("RelayConnectionError"));
  });
  const next = vi.fn(),
    failure = vi.fn();
  const subscription = request([urls[0]]).subscribe({ next, error: failure });
  vi.advanceTimersByTime(120000);
  expect(subscription.closed).toBe(false);
  expect(state().requests).toBe(1);
  available = true;
  vi.advanceTimersByTime(60000);
  expect(next).toHaveBeenCalledExactlyOnceWith({ relay: urls[0], response: { count: 9 } });
  expect(failure).not.toHaveBeenCalled();
  expect(state()).toMatchObject({ active: 0, requests: 0 });
});

it("keeps retrying an invalid query at a bounded rate rather than spinning", () => {
  vi.useFakeTimers();
  const { request, count } = setup(() => throwError(() => error("RelayClosedError", "invalid: filter")));
  const subscription = request([urls[0]]).subscribe();
  vi.advanceTimersByTime(3000);
  expect(count).toHaveBeenCalledTimes(4);
  expect(subscription.closed).toBe(false);
  subscription.unsubscribe();
  expect(vi.getTimerCount()).toBe(0);
});

it("resumes persistent demand after a fractional jittered cooldown", () => {
  vi.useFakeTimers();
  let available = false;
  const { request } = setup(() => (available ? of({ count: 3 }) : throwError(() => error("RelayConnectionError"))), {
    random: () => 0.731,
  });
  const next = vi.fn();
  request([urls[0]]).subscribe(next);
  available = true;
  vi.advanceTimersByTime(1092);
  expect(next).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(next).toHaveBeenCalledExactlyOnceWith({ relay: urls[0], response: { count: 3 } });
});
