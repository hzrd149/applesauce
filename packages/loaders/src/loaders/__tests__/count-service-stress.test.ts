import { afterEach, expect, it, vi } from "vitest";
import { Observable, Subscription, timer } from "rxjs";
import { createCountService, relayCountSource } from "../index.js";
import type { CountRequest } from "../index.js";

afterEach(() => vi.useRealTimers());
it("bounds transport work across 60 seconds of scrolling through 10000 targets", () => {
  vi.useFakeTimers();
  const relay = "wss://stress.test/";
  let starts = 0,
    completed = 0,
    cancelled = 0,
    abandoned = 0,
    active = 0,
    peak = 0,
    pendingPeak = 0;
  let hits = 0,
    retainedPeak = 0,
    registryPeak = 0;
  const latencies: number[] = [];
  const count: CountRequest = () =>
    new Observable((subscriber) => {
      starts++;
      active++;
      let done = false;
      const task = timer(150).subscribe(() => {
        done = true;
        completed++;
        subscriber.next({ [relay]: { ok: true, value: { count: 42 } } });
        subscriber.complete();
      });
      return () => {
        if (!done) cancelled++;
        active--;
        task.unsubscribe();
      };
    });
  const service = createCountService({
    sources: [relayCountSource({ relays: [relay], count })],
    cacheCapacity: 200,
    concurrency: 8,
    perRelay: 2,
    ttl: () => 300000,
    diagnostic: (event) => {
      peak = Math.max(peak, event.active);
      pendingPeak = Math.max(pendingPeak, event.pending);
      retainedPeak = Math.max(retainedPeak, event.cacheEntries);
      registryPeak = Math.max(registryPeak, event.activeMetrics);
      expect(event.cacheEntries).toBeLessThanOrEqual(200 + event.activeMetrics);
      if (event.type === "first-value" && event.latency) latencies.push(event.latency);
      if (event.type === "abandoned") abandoned++;
      if (event.type === "cache-hit") hits++;
    },
  });
  const targets = Array.from({ length: 10000 }, (_, i) => ({
    id: i.toString(16).padStart(64, "0"),
    kind: 1,
    created_at: 0,
  }));
  let viewport = new Subscription();
  let resolved = new Set<string>();
  const view = (offset: number) => {
    viewport.unsubscribe();
    viewport = new Subscription();
    resolved = new Set();
    for (const target of targets.slice(offset, offset + 30)) {
      const handle = service.event(target);
      for (const [name, metric] of [
        ["reactions", handle.reactions$],
        ["comments", handle.comments$],
      ] as const) {
        viewport.add(
          metric.subscribe((value) => {
            if (value !== undefined) resolved.add(target.id + name);
          }),
        );
        viewport.add(metric.subscribe());
      }
    }
  };
  for (let tick = 0; tick < 600; tick++) {
    view(Math.min(9970, tick * 20));
    vi.advanceTimersByTime(100);
  }
  view(5000);
  vi.advanceTimersByTime(4700);
  expect(resolved.size).toBe(60);
  const before = starts;
  view(5000);
  expect(resolved.size).toBe(60);
  expect(starts).toBe(before);
  viewport.unsubscribe();
  service.stop();
  expect(peak).toBeLessThanOrEqual(2);
  expect(pendingPeak).toBeLessThanOrEqual(256);
  expect(abandoned).toBeGreaterThan(1000);
  expect(active).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  console.log(
    JSON.stringify({
      scenario: "scroll-10000",
      seed: 1,
      milliseconds: 64700,
      latency: 150,
      starts,
      completed,
      cancelled,
      abandoned,
      peak,
      pendingPeak,
      hits,
      retainedPeak,
      registryPeak,
      p50: latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.5)],
      p95: latencies[Math.floor(latencies.length * 0.95)],
    }),
  );
}, 20000);
