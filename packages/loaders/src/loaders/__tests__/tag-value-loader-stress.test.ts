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
