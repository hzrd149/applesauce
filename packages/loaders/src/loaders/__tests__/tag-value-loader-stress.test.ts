import { NostrEvent } from "applesauce-core/helpers/event";
import { Observable, Subject } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTagValueLoader } from "../tag-value-loader.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function transport() {
  const state = { starts: 0, active: 0, peak: 0, values: 0 };
  const sources: Subject<NostrEvent>[] = [];
  const request = vi.fn(
    (_relays: string[], filters: { [key: string]: unknown }[]) =>
      new Observable<NostrEvent>((observer) => {
        state.starts++;
        state.values += (filters[0]["#e"] as string[]).length;
        state.peak = Math.max(state.peak, ++state.active);
        const source = new Subject<NostrEvent>();
        sources.push(source);
        const sub = source.subscribe(observer);
        return () => {
          state.active--;
          sub.unsubscribe();
        };
      }),
  );
  return { state, sources, request };
}

it("routes 1000 targets across 10 relays and releases all transports on stop", () => {
  const { state, request } = transport();
  const loader = createTagValueLoader(request, "e", {
    bufferSize: 200,
    maxConcurrentBatches: Infinity,
    relayConcurrency: Infinity,
  });
  for (let i = 0; i < 1000; i++) loader({ value: String(i), relays: [`wss://relay-${i % 10}.test/`] }).subscribe();
  expect(state.starts).toBe(50);
  expect(state.values).toBe(1000);
  // Explicitly unbounded baseline for comparison with configured limits.
  expect(state.peak).toBe(50);
  loader.stop();
  expect(state.active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("compacts 1000 repeated callers to 10 values per batch and delivers to every caller", () => {
  const { state, sources, request } = transport();
  const loader = createTagValueLoader(request, "e", {
    bufferSize: 200,
    maxConcurrentBatches: Infinity,
    shareInflight: false,
    extraRelays: ["wss://relay.test/"],
  });
  const deliveries = Array.from({ length: 1000 }, () => 0);
  for (let i = 0; i < 1000; i++)
    loader({ value: String(i % 10) }).subscribe(() => {
      deliveries[i]++;
    });
  expect(state.starts).toBe(5);
  expect(state.values).toBe(50);
  for (const source of sources) {
    for (let i = 0; i < 10; i++) {
      const event: NostrEvent = {
        id: String(i),
        pubkey: "a".repeat(64),
        sig: "b".repeat(128),
        kind: 7,
        created_at: 1,
        content: "+",
        tags: [["e", String(i)]],
      };
      source.next(event);
      source.next({ ...event });
    }
    source.complete();
  }
  expect(deliveries.every((count) => count === 1)).toBe(true);
  expect(state.active).toBe(0);
  loader.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("bounds relay fan-out and advances queued batches when stalled sources time out", () => {
  const { state, request } = transport();
  const onError = vi.fn();
  const loader = createTagValueLoader(request, "e", {
    bufferSize: 1,
    maxConcurrentBatches: 2,
    relayConcurrency: 3,
    requestTimeout: 100,
    onError,
  });
  let completed = 0;
  for (let i = 0; i < 20; i++)
    loader({ value: String(i), relays: Array.from({ length: 10 }, (_, j) => `wss://relay-${j}.test/`) }).subscribe({
      complete: () => {
        completed++;
      },
    });
  expect(state.starts).toBe(6);
  vi.advanceTimersByTime(4000);
  expect(completed).toBe(20);
  expect(state.starts).toBe(200);
  expect(state.peak).toBeLessThanOrEqual(6);
  expect(onError).toHaveBeenCalledTimes(200);
  expect(state.active).toBe(0);
  loader.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("drops queued work and active deadlines on stop", () => {
  const { state, request } = transport();
  const loader = createTagValueLoader(request, "e", { bufferSize: 1, maxConcurrentBatches: 1 });
  let completed = 0;
  for (let i = 0; i < 100; i++)
    loader({ value: String(i), relays: ["wss://relay.test/"] }).subscribe({
      complete: () => {
        completed++;
      },
    });
  expect(state.starts).toBe(1);
  loader.stop();
  expect(completed).toBe(100);
  expect(state.active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("shares one running target across 1000 callers and replays 2000 unique events", () => {
  const { state, sources, request } = transport();
  const loader = createTagValueLoader(request, "e", { bufferSize: 1, extraRelays: ["wss://relay.test/"] });
  let early = 0;
  loader({ value: "a" }).subscribe(() => {
    early++;
  });
  for (let i = 0; i < 2000; i++) {
    const event: NostrEvent = {
      id: String(i),
      pubkey: "a".repeat(64),
      sig: "b".repeat(128),
      kind: 7,
      created_at: 1,
      content: "+",
      tags: [["e", "a"]],
    };
    sources[0].next(event);
    sources[0].next({ ...event });
  }
  const deliveries = Array.from({ length: 999 }, () => 0);
  for (let i = 0; i < deliveries.length; i++)
    loader({ value: "a" }).subscribe(() => {
      deliveries[i]++;
    });
  expect(early).toBe(2000);
  expect(deliveries.every((count) => count === 2000)).toBe(true);
  expect(state.starts).toBe(1);
  sources[0].complete();
  loader.stop();
  expect(state.active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it("parses each arrival's relationship tags once when dispatching to 200 distinct callers", () => {
  const source = new Subject<NostrEvent>();
  const loader = createTagValueLoader(() => source, "e", {
    bufferSize: 200,
    extraRelays: ["wss://relay.test/"],
    eventStore: null,
    shareInflight: false,
  });
  let reads = 0;
  let deliveries = 0;
  for (let i = 0; i < 200; i++)
    loader({ value: String(i) }).subscribe(() => {
      deliveries++;
    });
  for (let i = 0; i < 1000; i++)
    source.next({
      id: String(i),
      pubkey: "a".repeat(64),
      sig: "b".repeat(128),
      kind: 7,
      created_at: 1,
      content: "+",
      get tags() {
        reads++;
        return Array.from({ length: 20 }, (_, j) => ["e", String((i + j) % 200)]);
      },
    });
  expect(reads).toBe(1000);
  expect(deliveries).toBe(20000);
  source.complete();
  loader.stop();
});

it("skips abandoned queued work during sustained subscription churn", () => {
  const { state, sources, request } = transport();
  const loader = createTagValueLoader(request, "e", { bufferSize: 1, maxConcurrentBatches: 1 });
  loader({ value: "initial", relays: ["wss://relay.test/"] }).subscribe();
  for (let i = 0; i < 1000; i++)
    loader({ value: String(i), relays: ["wss://relay.test/"] })
      .subscribe()
      .unsubscribe();
  sources[0].complete();
  expect(state.starts).toBe(1);
  expect(state.active).toBe(0);
  loader.stop();
  expect(vi.getTimerCount()).toBe(0);
});

it("delivers fast cache results before slow relays finish", () => {
  const relay = new Subject<NostrEvent>();
  const cache = new Subject<NostrEvent>();
  const loader = createTagValueLoader(() => relay, "e", {
    bufferTime: 10,
    extraRelays: ["wss://relay.test/"],
    cacheRequest: () => cache,
  });
  const started = Date.now();
  const arrivals: number[] = [];
  let completed = false;
  loader({ value: "a" }).subscribe({
    next: () => arrivals.push(Date.now() - started),
    complete: () => {
      completed = true;
    },
  });
  vi.advanceTimersByTime(10);
  vi.advanceTimersByTime(5);
  cache.next({
    id: "cache",
    pubkey: "a".repeat(64),
    sig: "b".repeat(128),
    kind: 7,
    created_at: 1,
    content: "+",
    tags: [["e", "a"]],
  });
  cache.complete();
  expect(arrivals).toEqual([15]);
  expect(completed).toBe(false);
  vi.advanceTimersByTime(100);
  relay.complete();
  expect(completed).toBe(true);
  loader.stop();
  expect(vi.getTimerCount()).toBe(0);
});
