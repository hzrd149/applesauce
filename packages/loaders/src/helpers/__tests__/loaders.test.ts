import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { bufferTime, Observable, of, Subject } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { batchLoader } from "../loaders.js";

// ---------------------------------------------------------------------------
// Active-interval probe (real timers) — counts setInterval timers that have not
// been cleared. Used to prove the bufferTime engine tears down naturally.
// ---------------------------------------------------------------------------
const realSet = globalThis.setInterval;
const realClear = globalThis.clearInterval;
let active: Set<any>;
function installProbe() {
  active = new Set();
  // @ts-expect-error probe
  globalThis.setInterval = (...a: Parameters<typeof setInterval>) => {
    const id = realSet(...a);
    active.add(id);
    return id;
  };
  // @ts-expect-error probe
  globalThis.clearInterval = (id: any) => {
    active.delete(id);
    return realClear(id);
  };
}
function restoreProbe() {
  globalThis.setInterval = realSet;
  globalThis.clearInterval = realClear;
  for (const id of active) realClear(id);
  active.clear();
}

describe("batchLoader", () => {
  describe("natural teardown (no explicit shutdown)", () => {
    beforeEach(() => installProbe());
    afterEach(() => restoreProbe());

    it("does not start a bufferTime interval at construction", () => {
      batchLoader(
        bufferTime(1000),
        () => of<number>(),
        () => true,
      );
      expect(active.size).toBe(0);
    });

    it("starts the engine on subscribe and tears it down on unsubscribe", () => {
      const loader = batchLoader<number, number>(
        bufferTime(1000),
        () => new Observable<number>(() => {}), // upstream never completes
        () => true,
      );

      const sub = loader(1).subscribe();
      expect(active.size).toBeGreaterThanOrEqual(1);

      sub.unsubscribe();
      expect(active.size).toBe(0);
    });
  });

  describe("explicit teardown", () => {
    beforeEach(() => installProbe());
    afterEach(() => restoreProbe());

    it("exposes stop() and Symbol.dispose", () => {
      const loader = batchLoader(
        bufferTime(1000),
        () => of<number>(),
        () => true,
      );
      expect(typeof loader.stop).toBe("function");
      expect(typeof loader[Symbol.dispose]).toBe("function");
    });

    it("stop() tears down the engine and completes in-flight loader observables", () => {
      const loader = batchLoader<number, number>(
        bufferTime(1000),
        () => new Observable<number>(() => {}),
        () => true,
      );

      const spy = subscribeSpyTo(loader(1), { expectErrors: true });
      expect(active.size).toBeGreaterThanOrEqual(1);

      loader.stop();
      expect(active.size).toBe(0);
      expect(spy.receivedComplete()).toBe(true);
    });

    it("tears down when an AbortSignal fires", () => {
      const controller = new AbortController();
      const loader = batchLoader<number, number>(
        bufferTime(1000),
        () => new Observable<number>(() => {}),
        () => true,
        undefined,
        { signal: controller.signal },
      );

      const spy = subscribeSpyTo(loader(1), { expectErrors: true });
      expect(active.size).toBeGreaterThanOrEqual(1);

      controller.abort();
      expect(active.size).toBe(0);
      expect(spy.receivedComplete()).toBe(true);
    });

    it("is already torn down when constructed with an aborted signal", () => {
      const controller = new AbortController();
      controller.abort();
      const loader = batchLoader<number, number>(
        bufferTime(1000),
        () => of(1),
        () => true,
        undefined,
        { signal: controller.signal },
      );

      // Pushing into a torn-down queue never resolves; the engine is dead.
      const spy = subscribeSpyTo(loader(1), { expectErrors: true });
      expect(spy.receivedComplete()).toBe(true);
      expect(spy.getValues()).toEqual([]);
    });
  });

  describe("batching still works", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it("batches inputs in the same window into a single upstream call", () => {
      const results = new Subject<number>();
      const upstream = vi.fn((_inputs: number[]) => results.asObservable());
      const loader = batchLoader<number, number>(bufferTime(1000), upstream, (input, output) => output === input * 10);

      const a = subscribeSpyTo(loader(1));
      const b = subscribeSpyTo(loader(2));

      vi.advanceTimersByTime(1000);

      expect(upstream).toHaveBeenCalledTimes(1);
      expect(upstream).toHaveBeenCalledWith([1, 2]);

      results.next(10);
      results.next(20);

      expect(a.getValues()).toEqual([10]);
      expect(b.getValues()).toEqual([20]);
    });
  });
});
