import { NostrEvent } from "applesauce-core/helpers/event";
import { EMPTY, Observable, of, Subject, throwError } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheTagValueLoader, createTagValueLoader, relaysTagValueLoader } from "../tag-value-loader.js";

const relay = "wss://one.test/";
const other = "wss://two.test/";
const event = (value: string, id = value): NostrEvent => ({
  id,
  pubkey: "a".repeat(64),
  sig: "b".repeat(128),
  kind: 7,
  created_at: 1,
  content: "+",
  tags: [["e", value]],
});

describe("tag value loader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("preserves zero since in cache and relay filters", () => {
    const cache = vi.fn(() => []);
    const request = vi.fn(() => EMPTY);
    cacheTagValueLoader(cache, "e", { since: 0 })([{ value: "a" }]).subscribe();
    relaysTagValueLoader(request, "e", { since: 0 })([{ value: "a", relays: [relay] }]).subscribe();
    expect(cache).toHaveBeenCalledWith([{ since: 0, "#e": ["a"] }]);
    expect(request).toHaveBeenCalledWith([relay], [{ since: 0, "#e": ["a"] }]);
  });

  it("deduplicates values per relay while preserving routing", () => {
    const request = vi.fn(() => EMPTY);
    relaysTagValueLoader(
      request,
      "e",
    )([
      { value: "a", relays: [relay] },
      { value: "a", relays: [relay, other] },
      { value: "b", relays: [other] },
    ]).subscribe();
    expect(request.mock.calls).toEqual([
      [[relay], [{ "#e": ["a"] }]],
      [[other], [{ "#e": ["a", "b"] }]],
    ]);
  });

  it("delivers synchronous results to every matching consumer and deduplicates sources", () => {
    const a = event("a");
    const b = event("b");
    const request = vi.fn(() => of(a, { ...a }, b));
    const loader = createTagValueLoader(request, "e", {
      bufferSize: 3,
      extraRelays: [relay],
      cacheRequest: () => [a, b],
    });
    const values: NostrEvent[][] = [[], [], []];
    loader({ value: "a" }).subscribe((e) => values[0].push(e));
    loader({ value: "a" }).subscribe((e) => values[1].push(e));
    loader({ value: "b" }).subscribe((e) => values[2].push(e));
    expect(values).toEqual([[a], [a], [b]]);
    loader.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns previously fetched events on a later explicit request", () => {
    const a = event("a");
    const loader = createTagValueLoader(() => of(a), "e", { bufferSize: 1, extraRelays: [relay] });
    const values: NostrEvent[] = [];
    loader({ value: "a" }).subscribe();
    loader({ value: "a" }).subscribe((e) => values.push(e));
    expect(values).toEqual([a]);
    loader.stop();
  });

  it("flushes on time and aborts started requests", () => {
    const controller = new AbortController();
    let active = 0;
    const request = vi.fn(
      () =>
        new Observable<NostrEvent>(() => {
          active++;
          return () => {
            active--;
          };
        }),
    );
    const loader = createTagValueLoader(request, "e", {
      bufferTime: 10,
      extraRelays: [relay],
      signal: controller.signal,
    });
    let complete = false;
    loader({ value: "a" }).subscribe({
      complete: () => {
        complete = true;
      },
    });
    expect(request).not.toHaveBeenCalled();
    vi.advanceTimersByTime(10);
    expect(active).toBe(1);
    controller.abort();
    expect(active).toBe(0);
    expect(complete).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues storing a started request after its consumer leaves", () => {
    const source = new Subject<NostrEvent>();
    const add = vi.fn((e: NostrEvent) => e);
    const loader = createTagValueLoader(() => source, "e", {
      bufferSize: 1,
      extraRelays: [relay],
      eventStore: { add, remove: () => false, update: () => {} },
    });
    const sub = loader({ value: "a" }).subscribe();
    sub.unsubscribe();
    source.next(event("a"));
    expect(add).toHaveBeenCalledTimes(1);
    source.complete();
    loader.stop();
  });
});

describe("tag value loader source failures", () => {
  it.each(["sync", "async"])("keeps healthy relays running after a %s relay failure", (mode) => {
    const failure = new Error("relay unavailable");
    const healthy = new Subject<NostrEvent>();
    const onError = vi.fn();
    const loader = createTagValueLoader(
      (relays) => {
        if (relays[0] === relay) {
          if (mode === "sync") throw failure;
          return throwError(() => failure);
        }
        return healthy;
      },
      "e",
      { bufferSize: 1, onError },
    );
    const values: NostrEvent[] = [];
    let complete = false;
    loader({ value: "a", relays: [relay, other] }).subscribe({
      next: (e) => values.push(e),
      complete: () => {
        complete = true;
      },
    });
    expect(complete).toBe(false);
    healthy.next(event("a"));
    healthy.complete();
    expect(values).toEqual([event("a")]);
    expect(complete).toBe(true);
    expect(onError).toHaveBeenCalledWith(failure, { source: "relay", relay });
    loader.stop();
  });

  it.each(["sync", "async"])("still queries relays after a %s cache failure", (mode) => {
    const failure = new Error("cache unavailable");
    const onError = vi.fn();
    const loader = createTagValueLoader(() => of(event("a")), "e", {
      bufferSize: 1,
      extraRelays: [relay],
      onError,
      cacheRequest: () => {
        if (mode === "sync") throw failure;
        return throwError(() => failure);
      },
    });
    const values: NostrEvent[] = [];
    loader({ value: "a" }).subscribe((e) => values.push(e));
    expect(values).toEqual([event("a")]);
    expect(onError).toHaveBeenCalledWith(failure, { source: "cache" });
    loader.stop();
  });

  it("reports all failed sources and completes without events", () => {
    const onError = vi.fn();
    const loader = createTagValueLoader(() => throwError(() => new Error("offline")), "e", {
      bufferSize: 1,
      extraRelays: [relay, other],
      onError,
    });
    let complete = false;
    loader({ value: "a" }).subscribe({
      complete: () => {
        complete = true;
      },
    });
    expect(complete).toBe(true);
    expect(onError).toHaveBeenCalledTimes(2);
    loader.stop();
  });
});

describe("tag value loader deadlines", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("expires a continuously emitting relay by total lifetime and preserves partial events", () => {
    const source = new Subject<NostrEvent>();
    const onError = vi.fn();
    const loader = createTagValueLoader(() => source, "e", {
      bufferSize: 1,
      extraRelays: [relay],
      requestTimeout: 100,
      onError,
    });
    const values: NostrEvent[] = [];
    let complete = false;
    loader({ value: "a" }).subscribe({
      next: (e) => values.push(e),
      complete: () => {
        complete = true;
      },
    });
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(20);
      source.next(event("a", String(i)));
    }
    expect(complete).toBe(false);
    vi.advanceTimersByTime(20);
    expect(complete).toBe(true);
    expect(values).toHaveLength(4);
    expect(source.observed).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { source: "relay", relay });
    loader.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires a silent cache without discarding relay results", () => {
    const cache = new Subject<NostrEvent>();
    const onError = vi.fn();
    const loader = createTagValueLoader(() => of(event("a")), "e", {
      bufferSize: 1,
      extraRelays: [relay],
      requestTimeout: 100,
      cacheRequest: () => cache,
      onError,
    });
    const values: NostrEvent[] = [];
    let complete = false;
    loader({ value: "a" }).subscribe({
      next: (e) => values.push(e),
      complete: () => {
        complete = true;
      },
    });
    expect(values).toEqual([event("a")]);
    expect(complete).toBe(false);
    vi.advanceTimersByTime(100);
    expect(complete).toBe(true);
    expect(cache.observed).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { source: "cache" });
    loader.stop();
  });

  it("allows disabling deadlines", () => {
    const source = new Subject<NostrEvent>();
    const loader = createTagValueLoader(() => source, "e", {
      bufferSize: 1,
      extraRelays: [relay],
      requestTimeout: Infinity,
    });
    loader({ value: "a" }).subscribe();
    vi.advanceTimersByTime(60000);
    expect(source.observed).toBe(true);
    loader.stop();
    expect(source.observed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("tag value loader relay discovery", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("starts hints immediately and times out silent relay discovery", () => {
    const routes = new Subject<string[]>();
    const request = vi.fn(() => of(event("a")));
    const onError = vi.fn();
    const loader = createTagValueLoader(request, "e", {
      bufferSize: 1,
      extraRelays: routes,
      requestTimeout: 100,
      onError,
    });
    const values: NostrEvent[] = [];
    let complete = false;
    loader({ value: "a", relays: [relay] }).subscribe({
      next: (e) => values.push(e),
      complete: () => {
        complete = true;
      },
    });
    expect(values).toEqual([event("a")]);
    expect(request).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(complete).toBe(true);
    expect(routes.observed).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(Error), { source: "routing" });
    loader.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([EMPTY, throwError(() => new Error("routing failed"))])(
    "preserves hints when discovery ends without relays",
    (extraRelays) => {
      const request = vi.fn(() => of(event("a")));
      const loader = createTagValueLoader(request, "e", { bufferSize: 1, extraRelays });
      let complete = false;
      loader({ value: "a", relays: [relay] }).subscribe({
        complete: () => {
          complete = true;
        },
      });
      expect(request).toHaveBeenCalledWith([relay], [{ "#e": ["a"] }]);
      expect(complete).toBe(true);
      loader.stop();
    },
  );

  it("shares the concurrency budget and requests only uncovered values on discovered relays", () => {
    const routes = new Subject<string[]>();
    const sources: Subject<NostrEvent>[] = [];
    const request = vi.fn(() => {
      const source = new Subject<NostrEvent>();
      sources.push(source);
      return source;
    });
    const loader = createTagValueLoader(request, "e", { bufferSize: 2, relayConcurrency: 1, extraRelays: routes });
    loader({ value: "a", relays: [relay] }).subscribe();
    loader({ value: "b", relays: [other] }).subscribe();
    routes.next([relay, other]);
    expect(request).toHaveBeenCalledTimes(1);
    sources[0].complete();
    sources[1].complete();
    sources[2].complete();
    sources[3].complete();
    expect(request.mock.calls).toEqual([
      [[relay], [{ "#e": ["a"] }]],
      [[other], [{ "#e": ["b"] }]],
      [[other], [{ "#e": ["a"] }]],
      [[relay], [{ "#e": ["b"] }]],
    ]);
    expect(routes.observed).toBe(false);
    loader.stop();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("tag value loader forced requests", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("skips forced pointers in cache filters and skips all-forced cache queries", () => {
    const cache = vi.fn(() => []);
    const load = cacheTagValueLoader(cache, "e");
    load([{ value: "a", force: true }]).subscribe();
    expect(cache).not.toHaveBeenCalled();
    load([{ value: "a", force: true }, { value: "b" }]).subscribe();
    expect(cache).toHaveBeenCalledWith([{ "#e": ["b"] }]);
  });

  it.each(["cache-first", "relay-first"])("preserves provenance in a mixed batch (%s)", (order) => {
    const cache = new Subject<NostrEvent>();
    const relayEvents = new Subject<NostrEvent>();
    const loader = createTagValueLoader(() => relayEvents, "e", {
      bufferSize: 2,
      extraRelays: [relay],
      cacheRequest: () => cache,
    });
    const ordinary: NostrEvent[] = [];
    const forced: NostrEvent[] = [];
    loader({ value: "a" }).subscribe((e) => ordinary.push(e));
    loader({ value: "a", force: true }).subscribe((e) => forced.push(e));
    const a = event("a");
    const cachedOnly = event("a", "cached-only");
    if (order === "cache-first") {
      cache.next(a);
      cache.next(cachedOnly);
      expect(forced).toEqual([]);
      relayEvents.next({ ...a });
    } else {
      relayEvents.next(a);
      cache.next({ ...a });
      cache.next(cachedOnly);
    }
    cache.complete();
    relayEvents.complete();
    expect(ordinary).toEqual([a, cachedOnly]);
    expect(forced).toEqual([a]);
    loader.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps cache-only events out of forced callers when deduplication is disabled", () => {
    const a = event("a");
    const loader = createTagValueLoader(() => of(a, a), "e", {
      bufferSize: 2,
      extraRelays: [relay],
      cacheRequest: () => [a],
      eventStore: null,
    });
    const ordinary: NostrEvent[] = [];
    const forced: NostrEvent[] = [];
    loader({ value: "a" }).subscribe((e) => ordinary.push(e));
    loader({ value: "a", force: true }).subscribe((e) => forced.push(e));
    expect(ordinary).toHaveLength(3);
    expect(forced).toHaveLength(2);
    loader.stop();
  });
});

it("preserves source identity when an asynchronous store returns one canonical event", async () => {
  const a = event("a");
  const add = vi.fn(async () => a);
  const loader = createTagValueLoader(() => of({ ...a }), "e", {
    bufferSize: 2,
    extraRelays: [relay],
    cacheRequest: () => [a],
    eventStore: { add, remove: async () => false, update: async () => {} },
  });
  const ordinary: NostrEvent[] = [];
  const forced: NostrEvent[] = [];
  const first = new Promise<void>((resolve) =>
    loader({ value: "a" }).subscribe({
      next: (e) => ordinary.push(e),
      complete: resolve,
    }),
  );
  const second = new Promise<void>((resolve) =>
    loader({ value: "a", force: true }).subscribe({
      next: (e) => forced.push(e),
      complete: resolve,
    }),
  );
  await Promise.all([first, second]);
  expect(ordinary).toEqual([a]);
  expect(forced).toEqual([a]);
  expect(add).toHaveBeenCalledTimes(2);
  loader.stop();
});

describe("tag value loader in-flight sharing", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("replays events to late callers with covered relay hints and refreshes after completion", () => {
    const source = new Subject<NostrEvent>();
    const request = vi.fn(() => source);
    const loader = createTagValueLoader(request, "e", { bufferSize: 1, extraRelays: [relay] });
    loader({ value: "a", relays: [other] }).subscribe();
    source.next(event("a"));
    const values: NostrEvent[] = [];
    loader({ value: "a" }).subscribe((e) => values.push(e));
    expect(values).toEqual([event("a")]);
    expect(request).toHaveBeenCalledTimes(2);
    source.complete();
    loader({ value: "a" }).subscribe();
    expect(request).toHaveBeenCalledTimes(3);
    loader.stop();
  });

  it("starts a new request when existing relay coverage is insufficient", () => {
    const request = vi.fn(() => new Subject<NostrEvent>());
    const loader = createTagValueLoader(request, "e", { bufferSize: 1 });
    loader({ value: "a", relays: [relay] }).subscribe();
    loader({ value: "a", relays: [other] }).subscribe();
    expect(request).toHaveBeenCalledTimes(2);
    loader.stop();
  });

  it.each([false, true])("does not share between forced and ordinary callers (first force=%s)", (force) => {
    const request = vi.fn(() => new Subject<NostrEvent>());
    const loader = createTagValueLoader(request, "e", { bufferSize: 1, extraRelays: [relay] });
    loader({ value: "a", force }).subscribe();
    loader({ value: "a", force: !force }).subscribe();
    expect(request).toHaveBeenCalledTimes(2);
    loader.stop();
  });

  it.each([{ shareInflight: false, extraRelays: [relay] }, { extraRelays: of([relay]) }])(
    "allows independent requests when sharing is disabled or routing is dynamic",
    (opts) => {
      const request = vi.fn(() => new Subject<NostrEvent>());
      const loader = createTagValueLoader(request, "e", { bufferSize: 1, ...opts });
      loader({ value: "a" }).subscribe();
      loader({ value: "a" }).subscribe();
      expect(request).toHaveBeenCalledTimes(2);
      loader.stop();
    },
  );
});

it.each([
  { maxConcurrentBatches: 0 },
  { maxConcurrentBatches: NaN },
  { relayConcurrency: -1 },
  { relayConcurrency: 1.5 },
  { requestTimeout: 0 },
  { requestTimeout: NaN },
  { requestTimeout: 2147483648 },
])("rejects invalid execution limits before requests can hang: %j", (opts) => {
  expect(() => createTagValueLoader(() => EMPTY, "e", opts)).toThrow(RangeError);
  expect(() => cacheTagValueLoader(() => [], "e", opts)).toThrow(RangeError);
  expect(() => relaysTagValueLoader(() => EMPTY, "e", opts)).toThrow(RangeError);
});

it("accepts a relay's clamped partial result without completeness retries", async () => {
  const request = vi.fn(() => of(event("popular")));
  const loader = createTagValueLoader(request, "e", { bufferSize: 2, extraRelays: [relay] });
  const popular: NostrEvent[] = [];
  const missing: NostrEvent[] = [];
  let completed = 0;
  loader({ value: "popular" }).subscribe({
    next: (e) => popular.push(e),
    complete: () => {
      completed++;
    },
  });
  loader({ value: "missing" }).subscribe({
    next: (e) => missing.push(e),
    complete: () => {
      completed++;
    },
  });
  expect(popular).toHaveLength(1);
  expect(missing).toEqual([]);
  expect(completed).toBe(2);
  expect(request).toHaveBeenCalledTimes(1);
  loader.stop();
});

it("shares queued requests before their upstream slot becomes available", () => {
  const source = new Subject<NostrEvent>();
  const request = vi.fn<() => Observable<NostrEvent>>(() => source);
  const loader = createTagValueLoader(request, "e", { bufferSize: 1, maxConcurrentBatches: 1, extraRelays: [relay] });
  loader({ value: "blocking" }).subscribe();
  const a: NostrEvent[] = [];
  const b: NostrEvent[] = [];
  loader({ value: "a" }).subscribe((e) => a.push(e));
  loader({ value: "a" }).subscribe((e) => b.push(e));
  expect(request).toHaveBeenCalledTimes(1);
  // The second request gets a synchronous source after the first slot is released.
  request.mockReturnValue(of(event("a")));
  source.complete();
  expect(request).toHaveBeenCalledTimes(2);
  expect(a).toEqual([event("a")]);
  expect(b).toEqual([event("a")]);
  loader.stop();
});
