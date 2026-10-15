import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter, matchFilter } from "applesauce-core/helpers/filter";
import { EventStore } from "applesauce-core";
import { BehaviorSubject, defer, EMPTY, lastValueFrom, of, Subject, throwError, toArray } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTimelineLoader,
  createOutboxTimelineLoader,
  TimelineWindow,
  TimelineStatus,
} from "../timeline-loader.js";

const event = (created_at: number, kind = 1): NostrEvent => ({
  created_at,
  kind,
  id: `${kind}-${created_at}`,
  pubkey: "a".repeat(64),
  tags: [],
  content: "",
  sig: "",
});
const window = (since: number, until: number): TimelineWindow => ({ since, until });
async function flush() {
  for (let i = 0; i < 200; i++) await Promise.resolve();
}
function relay(events: Record<string, NostrEvent[]>, cap = Infinity) {
  return vi.fn((relays: string[], filters: Filter[]) =>
    of(
      ...filters.flatMap((filter) =>
        (events[relays[0]] ?? [])
          .filter((event) => matchFilter(filter, event))
          .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
          .slice(0, Math.min(filter.limit ?? Infinity, cap)),
      ),
    ),
  );
}

describe("reactive timeline windows", () => {
  afterEach(() => vi.useRealTimers());

  it("drains a finite range with short relay pages without another window emission", async () => {
    const events = Array.from({ length: 30 }, (_, i) => event(100 + i));
    const request = relay({ a: events }, 3);
    const loader = createTimelineLoader(request, ["a"], { kinds: [1] }, { prefetch: 0 });
    const result = await lastValueFrom(loader(window(100, 129)).pipe(toArray()));
    expect(new Set(result.map((e) => e.id))).toEqual(new Set(events.map((e) => e.id)));
    expect(request.mock.calls.every(([, filters]) => filters[0].limit === 100)).toBe(true);
    expect(request.mock.calls.every(([, filters]) => filters[0].since === undefined && filters[0].until! <= 129)).toBe(
      true,
    );
  });

  it("loads dense and sparse relays independently and deduplicates their events", async () => {
    const dense = Array.from({ length: 20 }, (_, i) => event(100 + i));
    const request = relay({ a: dense, b: [dense[0], dense[19]] }, 4);
    const events = await lastValueFrom(
      createTimelineLoader(request, ["a", "b"], {}, { prefetch: 0 })(window(100, 119)).pipe(toArray()),
    );
    expect(events).toHaveLength(20);
    expect(request.mock.calls.filter(([relays]) => relays[0] === "a").length).toBeGreaterThan(
      request.mock.calls.filter(([relays]) => relays[0] === "b").length,
    );
  });

  it("fills a forward gap newest-first without advancing past missing events", async () => {
    const events = Array.from({ length: 30 }, (_, i) => event(100 + i));
    const request = relay({ a: events }, 4);
    const windows = new Subject<TimelineWindow>();
    const received = new Set<string>();
    const sub = createTimelineLoader(request, ["a"], {}, { prefetch: 0 })(windows).subscribe((e) => received.add(e.id));
    windows.next(window(100, 105));
    await flush();
    windows.next(window(110, 129));
    await flush();
    expect([...received]).toEqual(
      expect.arrayContaining(events.filter((e) => e.created_at <= 105 || e.created_at >= 110).map((e) => e.id)),
    );
    sub.unsubscribe();
  });

  it("combines visible and buffer loading and reuses an anchored buffer", async () => {
    const request = relay({});
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a"], {})(windows).subscribe();
    windows.next(window(1000, 1100));
    await flush();
    expect(request.mock.calls[0][1][0]).toEqual({ until: 1160, limit: 100 });
    expect(request).toHaveBeenCalledTimes(1);
    const count = request.mock.calls.length;
    windows.next(window(1005, 1105));
    await flush();
    windows.next(window(995, 1095));
    await flush();
    expect(request).toHaveBeenCalledTimes(count);
    windows.next(window(1040, 1140));
    await flush();
    expect(request.mock.calls.length).toBeGreaterThan(count);
    sub.unsubscribe();
  });

  it("does not repeatedly reanchor the buffer when the window ends at now", async () => {
    vi.useFakeTimers({ now: 1000_000 });
    const request = relay({});
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a"], {})(windows).subscribe();
    windows.next(window(900, 1000));
    await vi.runAllTimersAsync();
    const count = request.mock.calls.length;
    windows.next(window(905, 1005));
    await vi.runAllTimersAsync();
    // Capping at now shrinks this window and may resize the buffer, but covered ranges remain reusable.
    expect(request).toHaveBeenCalledTimes(count);
    sub.unsubscribe();
  });

  it("jumps directly to disconnected ranges and reuses earlier coverage", async () => {
    const request = relay({});
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a"], {}, { prefetch: 0 })(windows).subscribe();
    windows.next(window(100, 200));
    await flush();
    windows.next(window(10000, 10100));
    await flush();
    windows.next(window(100, 200));
    await flush();
    expect(request.mock.calls.map(([, f]) => [f[0].since, f[0].until])).toEqual([
      [undefined, 200],
      [201, 10100],
    ]);
    sub.unsubscribe();
  });

  it("coalesces changing windows while a page is in flight", async () => {
    const first = new Subject<NostrEvent>();
    const request = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockImplementation(() => of());
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a"], {}, { prefetch: 0 })(windows).subscribe();
    windows.next(window(100, 200));
    await flush();
    windows.next(window(90, 190));
    windows.next(window(80, 180));
    first.next(event(150));
    first.complete();
    await flush();
    expect(request.mock.calls.map(([, f]) => [f[0].since, f[0].until])).toEqual([
      [undefined, 200],
      [undefined, 150],
    ]);
    sub.unsubscribe();
  });

  it("cancels abandoned requests without committing their coverage", async () => {
    const first = new Subject<NostrEvent>();
    const second = new Subject<NostrEvent>();
    const request = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockImplementation(() => of());
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a"], {}, { prefetch: 0 })(windows).subscribe();
    windows.next(window(100, 200));
    await flush();
    first.next(event(150));
    windows.next(window(1000, 1100));
    await flush();
    expect(first.observed).toBe(false);
    windows.next(window(100, 200));
    await flush();
    expect(request.mock.calls.map(([, f]) => f[0].until)).toEqual([200, 1100, 200]);
    sub.unsubscribe();
  });

  it("keeps healthy relays running and retries failed ranges on the next window", async () => {
    let fail = true;
    const request = vi.fn((relays: string[]) =>
      relays[0] === "a" && fail ? throwError(() => new Error("offline")) : of(),
    );
    const windows = new Subject<TimelineWindow>();
    const statuses: TimelineStatus[] = [];
    const sub = createTimelineLoader(
      request,
      ["a", "b"],
      {},
      { prefetch: 0, onStatus: (status) => statuses.push(status) },
    )(windows).subscribe();
    windows.next(window(100, 200));
    await flush();
    expect(statuses.some((s) => s.source === "a" && s.state === "incomplete")).toBe(true);
    expect(statuses.some((s) => s.source === "b" && s.state === "covered")).toBe(true);
    fail = false;
    windows.next(window(100, 200));
    await flush();
    expect(request.mock.calls.filter(([r]) => r[0] === "a")).toHaveLength(2);
    expect(request.mock.calls.filter(([r]) => r[0] === "b")).toHaveLength(1);
    sub.unsubscribe();
  });

  it("reports unpageable boundary seconds rather than looping or claiming complete coverage", async () => {
    const crowded = Array.from({ length: 10 }, (_, i) => ({ ...event(150), id: `id-${i}` }));
    const statuses: TimelineStatus[] = [];
    const request = relay({ a: crowded }, 3);
    await lastValueFrom(
      createTimelineLoader(
        request,
        ["a"],
        {},
        { prefetch: 0, onStatus: (status) => statuses.push(status) },
      )(window(100, 200)).pipe(toArray()),
    );
    expect(request.mock.calls.length).toBeLessThan(5);
    expect(statuses.at(-1)?.state).toBe("incomplete");
  });

  it("isolates filters and stores events before deduplicating output", async () => {
    const store = new EventStore({ verifyEvent: () => true });
    const events = [event(120), event(130, 2)];
    const result = await lastValueFrom(
      createTimelineLoader(relay({ a: events }), ["a"], [{ kinds: [1] }, { kinds: [2] }], {
        prefetch: 0,
        eventStore: store,
      })(window(100, 200)).pipe(toArray()),
    );
    expect(result).toHaveLength(2);
    expect(store.hasEvent(events[0].id)).toBe(true);
    expect(store.hasEvent(events[1].id)).toBe(true);
  });

  it("waits for outboxes and cancels removed relays", async () => {
    const outboxes = new Subject<Record<string, { pubkey: string }[]>>();
    const windows = new BehaviorSubject(window(100, 200));
    const pending = new Subject<NostrEvent>();
    const request = vi.fn().mockReturnValue(pending);
    const sub = createOutboxTimelineLoader(request, outboxes, {}, { prefetch: 0 })(windows).subscribe();
    await flush();
    expect(request).not.toHaveBeenCalled();
    outboxes.next({ a: [{ pubkey: "a".repeat(64) }] });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    outboxes.next({});
    expect(pending.observed).toBe(false);
    sub.unsubscribe();
  });

  it("loads a delayed outbox map from cache without losing the initial window", async () => {
    const outboxes = new Subject<Record<string, { pubkey: string }[]>>();
    const cache = vi.fn(() => of());
    const sub = createOutboxTimelineLoader(
      relay({}),
      outboxes,
      {},
      { prefetch: 0, cache },
    )(of(window(100, 200))).subscribe();
    await flush();
    outboxes.next({ a: [{ pubkey: "a".repeat(64) }] });
    await flush();
    expect(cache).toHaveBeenCalled();
    sub.unsubscribe();
  });

  it("tears down requests when the consumer disconnects", async () => {
    const pending = new Subject<NostrEvent>();
    const sub = createTimelineLoader(() => pending, ["a"], {})(new BehaviorSubject(window(100, 200))).subscribe();
    await flush();
    expect(pending.observed).toBe(true);
    sub.unsubscribe();
    expect(pending.observed).toBe(false);
  });

  it("rejects invalid options and implicit or infinite windows", async () => {
    expect(() => createTimelineLoader(relay({}), [], {}, { limit: 0 })).toThrow();
    expect(() => createTimelineLoader(relay({}), [], {}, { prefetch: -1 })).toThrow();
    await expect(
      lastValueFrom(createTimelineLoader(relay({}), ["a"], {})(window(-Infinity, Infinity))),
    ).rejects.toThrow("finite integer");
  });
  it("completes a single window with a live outbox map and cache", async () => {
    const outboxes = new BehaviorSubject({ a: [{ pubkey: "a".repeat(64) }] });
    const loader = createOutboxTimelineLoader(relay({}), outboxes, {}, { prefetch: 0, cache: () => of() });
    expect(await lastValueFrom(loader(window(100, 200)).pipe(toArray()))).toEqual([]);
    expect(outboxes.observed).toBe(false);
  });

  it("removes stale relay statuses when outboxes change", async () => {
    const outboxes = new BehaviorSubject({ a: [{ pubkey: "a".repeat(64) }] });
    const loader = createOutboxTimelineLoader(relay({}), outboxes, {}, { prefetch: 0 });
    let statuses: TimelineStatus[] = [];
    const statusSub = loader.status$.subscribe((next) => {
      statuses = next;
    });
    const sub = loader(new BehaviorSubject(window(100, 200))).subscribe();
    await flush();
    expect(statuses.map((status) => status.source)).toEqual(["a"]);
    outboxes.next({} as typeof outboxes.value);
    await flush();
    expect(statuses).toEqual([]);
    sub.unsubscribe();
    statusSub.unsubscribe();
  });

  it("batches filters that need the same range into a single relay request", async () => {
    const request = relay({});
    await lastValueFrom(
      createTimelineLoader(request, ["a"], [{ kinds: [1] }, { kinds: [2] }], { prefetch: 0 })(window(100, 200)).pipe(
        toArray(),
      ),
    );
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toHaveLength(2);
  });

  it("preempts speculative work when another visible range is needed", async () => {
    const prefetch = new Subject<NostrEvent>();
    const request = vi
      .fn()
      .mockReturnValueOnce(of(event(950)))
      .mockReturnValueOnce(prefetch)
      .mockImplementation(() => of());
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a"], {})(windows).subscribe();
    windows.next(window(1000, 1100));
    await flush();
    expect(prefetch.observed).toBe(true);
    windows.next(window(1040, 1140));
    await flush();
    expect(prefetch.observed).toBe(false);
    expect(request.mock.calls[2][1][0]).toMatchObject({ since: 1161, until: 1200 });
    sub.unsubscribe();
  });

  it("keeps unchanged outbox requests alive and restarts changed filters", async () => {
    const pending = new Subject<NostrEvent>();
    const request = vi.fn((_relays: string[], _filters: Filter[]) => pending);
    const outboxes = new BehaviorSubject({ a: [{ pubkey: "a".repeat(64) }] });
    const sub = createOutboxTimelineLoader(
      request,
      outboxes,
      {},
      { prefetch: 0 },
    )(new BehaviorSubject(window(100, 200))).subscribe();
    await flush();
    outboxes.next({ a: [{ pubkey: "a".repeat(64) }] });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    outboxes.next({ a: [{ pubkey: "b".repeat(64) }] });
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1][0].authors).toEqual(["b".repeat(64)]);
    sub.unsubscribe();
  });

  it("shares one session when the same returned stream has multiple subscribers", async () => {
    const request = relay({});
    const stream = createTimelineLoader(request, ["a"], {}, { prefetch: 0 })(new BehaviorSubject(window(100, 200)));
    const first = stream.subscribe();
    const second = stream.subscribe();
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("avoids tiny prefetch requests when the viewport duration jitters", async () => {
    const request = relay({});
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a", "b"], {})(windows).subscribe();
    windows.next(window(1000, 2000));
    await flush();
    const initial = request.mock.calls.length;
    for (let i = 1; i <= 20; i++) {
      windows.next(window(1000 + i, 2000));
      await flush();
    }
    expect(request).toHaveBeenCalledTimes(initial);
    expect(initial).toBe(2);
    sub.unsubscribe();
  });

  it("does not let a stalled relay block another relay's visible coverage", async () => {
    const stalled = new Subject<NostrEvent>();
    const statuses: TimelineStatus[] = [];
    const request = vi.fn((relays: string[]) => (relays[0] === "a" ? stalled : of()));
    const sub = createTimelineLoader(
      request,
      ["a", "b"],
      {},
      { prefetch: 0, onStatus: (status) => statuses.push(status) },
    )(new BehaviorSubject(window(100, 200))).subscribe();
    await flush();
    expect(statuses.some((status) => status.source === "b" && status.state === "covered")).toBe(true);
    expect(stalled.observed).toBe(true);
    sub.unsubscribe();
  });
  it("keeps visible coverage successful when a speculative request fails", async () => {
    const statuses: TimelineStatus[] = [];
    const request = vi
      .fn()
      .mockReturnValueOnce(of(event(950)))
      .mockReturnValueOnce(throwError(() => new Error("offline")))
      .mockReturnValue(of());
    await lastValueFrom(
      createTimelineLoader(
        request,
        ["a"],
        {},
        { onStatus: (status) => statuses.push(status) },
      )(window(1000, 1100)).pipe(toArray()),
    );
    expect(statuses.at(-1)?.state).toBe("covered");
    expect(request.mock.calls.some(([, filters]) => filters[0].until === 950)).toBe(true);
  });
  it("does not retry failed visible and buffer ranges in a loop", async () => {
    const request = vi.fn(() => throwError(() => new Error("offline")));
    await lastValueFrom(createTimelineLoader(request, ["a"], {})(window(1000, 1100)).pipe(toArray()));
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("caps future upper bounds and leaves entirely future windows idle", async () => {
    vi.useFakeTimers({ now: 1000_000 });
    const request = relay({});
    const loader = createTimelineLoader(request, ["a"], {}, { prefetch: 0 });
    const first = lastValueFrom(loader(window(1100, 1200)).pipe(toArray()));
    await vi.runAllTimersAsync();
    expect(await first).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    const second = lastValueFrom(loader(window(900, 1200)).pipe(toArray()));
    await vi.runAllTimersAsync();
    await second;
    expect(request.mock.calls[0][1][0]).toMatchObject({ until: 1000 });
  });

  it("does not alternate failed buffer ranges indefinitely", async () => {
    const request = vi
      .fn()
      .mockReturnValueOnce(of(event(950)))
      .mockImplementation(() => throwError(() => new Error("offline")));
    await lastValueFrom(createTimelineLoader(request, ["a"], {})(window(1000, 1100)).pipe(toArray()));
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("does not let a sparse filter advance a dense filter's coverage", async () => {
    const events = [...Array.from({ length: 40 }, (_, i) => event(100 + i)), event(105, 2), event(135, 2)];
    const request = relay({ a: events }, 3);
    const result = await lastValueFrom(
      createTimelineLoader(request, ["a"], [{ kinds: [1] }, { kinds: [2] }], { prefetch: 0 })(window(100, 140)).pipe(
        toArray(),
      ),
    );
    expect(new Set(result.map((event) => event.id))).toEqual(new Set(events.map((event) => event.id)));
  });

  it("keeps cache coverage separate from relay coverage", async () => {
    const cached = event(150);
    const request = relay({ a: [event(160)] });
    const cache = vi.fn((filters: Filter[]) => of(...[cached].filter((event) => matchFilter(filters[0], event))));
    const result = await lastValueFrom(
      createTimelineLoader(request, ["a"], {}, { prefetch: 0, cache })(window(100, 200)).pipe(toArray()),
    );
    expect(new Set(result.map((event) => event.created_at))).toEqual(new Set([150, 160]));
    expect(request).toHaveBeenCalled();
    expect(cache).toHaveBeenCalled();
  });
  it("fills the visible and older buffer ranges with full batches instead of tiny bounded requests", async () => {
    const events = Array.from({ length: 201 }, (_, i) => event(900 + i));
    const request = relay({ a: events });
    const result = await lastValueFrom(createTimelineLoader(request, ["a"], {})(window(1000, 1100)).pipe(toArray()));
    expect(request.mock.calls.map(([, filters]) => filters[0])).toEqual([
      { until: 1160, limit: 100 },
      { until: 1001, limit: 100 },
    ]);
    expect(result).toHaveLength(199); // The inclusive boundary event is deduplicated.
    for (const event of events.filter((event) => event.created_at >= 940))
      expect(result.some((loaded) => loaded.id === event.id)).toBe(true);
  });

  it("keeps a useful speculative request alive when scrolling into its range", async () => {
    const pending = new Subject<NostrEvent>();
    const request = vi
      .fn()
      .mockReturnValueOnce(of(event(950)))
      .mockReturnValueOnce(pending)
      .mockReturnValue(of());
    const windows = new Subject<TimelineWindow>();
    const sub = createTimelineLoader(request, ["a"], {})(windows).subscribe();
    windows.next(window(1000, 1100));
    await flush();
    expect(pending.observed).toBe(true);
    windows.next(window(945, 1045));
    await flush();
    expect(pending.observed).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    pending.complete();
    await flush();
    sub.unsubscribe();
  });
  it("completes empty window sources without starting requests", async () => {
    const request = relay({});
    expect(await lastValueFrom(createTimelineLoader(request, ["a"], {})(EMPTY).pipe(toArray()))).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("propagates a window error and cancels the current relay request", async () => {
    const windows = new Subject<TimelineWindow>();
    const pending = new Subject<NostrEvent>();
    const errors: unknown[] = [];
    createTimelineLoader(() => pending, ["a"], {})(windows).subscribe({ error: (error) => errors.push(error) });
    windows.next(window(100, 200));
    await flush();
    const error = new Error("viewport failed");
    windows.error(error);
    expect(errors).toEqual([error]);
    expect(pending.observed).toBe(false);
  });

  it("releases a removed relay branch and starts fresh when the relay returns", async () => {
    const pending = new Subject<NostrEvent>();
    const request = vi.fn(() => pending);
    const outboxes = new BehaviorSubject<Record<string, { pubkey: string }[]>>({ a: [{ pubkey: "a".repeat(64) }] });
    const sub = createOutboxTimelineLoader(
      request,
      outboxes,
      {},
      { prefetch: 0 },
    )(new BehaviorSubject(window(100, 200))).subscribe();
    await flush();
    expect(pending.observed).toBe(true);
    outboxes.next({});
    expect(pending.observed).toBe(false);
    outboxes.next({ a: [{ pubkey: "a".repeat(64) }] });
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(pending.observed).toBe(true);
    sub.unsubscribe();
    expect(outboxes.observed).toBe(false);
    expect(pending.observed).toBe(false);
  });

  it("connects a cold window source once for the relay and cache branches", async () => {
    const inputs = vi.fn(() => of(window(100, 200)));
    const request = relay({});
    const cache = vi.fn(() => of());
    await lastValueFrom(
      createTimelineLoader(request, ["a", "b"], {}, { prefetch: 0, cache })(defer(inputs)).pipe(toArray()),
    );
    expect(inputs).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(cache).toHaveBeenCalledTimes(1);
  });

  it("freezes a live outbox map after the last finite window and drains existing work", async () => {
    const pending = new Subject<NostrEvent>();
    const request = vi.fn(() => pending);
    const outboxes = new BehaviorSubject<Record<string, { pubkey: string }[]>>({ a: [{ pubkey: "a".repeat(64) }] });
    const result = lastValueFrom(
      createOutboxTimelineLoader(request, outboxes, {}, { prefetch: 0 })(of(window(100, 200))).pipe(toArray()),
    );
    await flush();
    expect(outboxes.observed).toBe(false);
    outboxes.next({ b: [{ pubkey: "b".repeat(64) }] });
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    pending.complete();
    expect(await result).toEqual([]);
  });

  it("cancels outbox work when the map errors", async () => {
    const pending = new Subject<NostrEvent>();
    const outboxes = new BehaviorSubject({ a: [{ pubkey: "a".repeat(64) }] });
    const errors: unknown[] = [];
    createOutboxTimelineLoader(
      () => pending,
      outboxes,
      {},
    )(new BehaviorSubject(window(100, 200))).subscribe({ error: (error) => errors.push(error) });
    await flush();
    const error = new Error("outbox failed");
    outboxes.error(error);
    expect(errors).toEqual([error]);
    expect(pending.observed).toBe(false);
  });
});
