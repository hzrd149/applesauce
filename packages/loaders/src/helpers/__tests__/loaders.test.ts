import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { bufferTime, Observable, of, Subject, tap } from "rxjs";
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

    it("delivers synchronous upstream results to every consumer in the batch", () => {
      const loader = batchLoader<number, number>(
        bufferTime(1000),
        () => of(10, 20),
        (input, output) => output === input * 10,
      );

      const a = subscribeSpyTo(loader(1));
      const b = subscribeSpyTo(loader(2));
      const c = subscribeSpyTo(loader(2));
      vi.advanceTimersByTime(1000);

      expect(a.getValues()).toEqual([10]);
      expect(b.getValues()).toEqual([20]);
      expect(c.getValues()).toEqual([20]);
      expect(c.receivedComplete()).toBe(true);
    });

    it("delivers synchronous results when the buffer size triggers the flush", () => {
      const loader = batchLoader<number, number>(
        bufferTime(1000, undefined, 2),
        () => of(10, 20),
        (input, output) => output === input * 10,
      );

      const a = subscribeSpyTo(loader(1));
      const b = subscribeSpyTo(loader(2));

      expect(a.getValues()).toEqual([10]);
      expect(b.getValues()).toEqual([20]);
    });
  });
});

describe("batchLoader request pressure", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  /** An upstream that tracks active requests and emits results when told to */
  const tracked = () => {
    const state = { calls: 0, active: 0, peak: 0, subjects: [] as Subject<number>[] };
    const upstream = (_inputs: number[]) =>
      new Observable<number>((observer) => {
        const subject = new Subject<number>();
        state.subjects.push(subject);
        state.calls++;
        state.peak = Math.max(state.peak, ++state.active);
        const sub = subject.subscribe(observer);
        return () => {
          state.active--;
          sub.unsubscribe();
        };
      });
    return { state, upstream };
  };
  const inflight = { key: (n: number) => String(n), covers: () => true };

  it("shares a running request with repeated inputs", () => {
    const { state, upstream } = tracked();
    const loader = batchLoader<number, number>(bufferTime(10), upstream, (i, o) => o === i * 10, undefined, {
      inflight,
    });

    const spies = Array.from({ length: 5 }, () => {
      const spy = subscribeSpyTo(loader(1));
      vi.advanceTimersByTime(10);
      return spy;
    });

    expect(state.calls).toBe(1);
    state.subjects[0].next(10);
    state.subjects[0].complete();
    for (const spy of spies) expect(spy.getValues()).toEqual([10]);
  });

  it("replays results already delivered to a joining input", () => {
    const { state, upstream } = tracked();
    const loader = batchLoader<number, number>(bufferTime(10), upstream, (i, o) => o === i * 10, undefined, {
      inflight,
    });

    subscribeSpyTo(loader(1));
    vi.advanceTimersByTime(10);
    state.subjects[0].next(10);

    const late = subscribeSpyTo(loader(1));
    state.subjects[0].complete();
    expect(late.getValues()).toEqual([10]);
    expect(late.receivedComplete()).toBe(true);
  });

  it("queues new requests for inputs the running request does not cover", () => {
    const { state, upstream } = tracked();
    const loader = batchLoader<number, number>(bufferTime(10), upstream, (i, o) => o === i * 10, undefined, {
      inflight: { ...inflight, covers: () => false },
    });

    subscribeSpyTo(loader(1));
    vi.advanceTimersByTime(10);
    subscribeSpyTo(loader(1));
    vi.advanceTimersByTime(10);

    expect(state.calls).toBe(2);
  });

  it("caps concurrent batches and runs queued ones as slots free up", () => {
    const { state, upstream } = tracked();
    const loader = batchLoader<number, number>(bufferTime(10, undefined, 1), upstream, () => true, undefined, {
      maxConcurrentBatches: 2,
    });

    for (let i = 0; i < 6; i++) subscribeSpyTo(loader(i));
    expect(state.calls).toBe(2);

    state.subjects[0].complete();
    expect(state.calls).toBe(3);
    expect(state.peak).toBe(2);
  });

  it("preserves batch order across compaction and completes remaining consumers on stop", () => {
    const started: number[] = [];
    let current = new Subject<number>();
    const loader = batchLoader<number, number>(
      bufferTime(10, undefined, 1),
      (inputs) => {
        started.push(inputs[0]);
        current = new Subject<number>();
        return current;
      },
      () => true,
      undefined,
      { maxConcurrentBatches: 1 },
    );
    const spies = Array.from({ length: 2201 }, (_, i) => subscribeSpyTo(loader(i)));
    for (let i = 0; i < 1100; i++) current.complete();

    expect(started).toEqual(Array.from({ length: 1101 }, (_, i) => i));
    loader.stop();
    expect(started).toHaveLength(1101);
    expect(spies.every((spy) => spy.receivedComplete())).toBe(true);
  });

  it("skips queued batches whose consumers unsubscribed", () => {
    const { state, upstream } = tracked();
    const loader = batchLoader<number, number>(bufferTime(10, undefined, 1), upstream, () => true, undefined, {
      maxConcurrentBatches: 1,
    });

    subscribeSpyTo(loader(1));
    const queued = subscribeSpyTo(loader(2));
    queued.unsubscribe();
    state.subjects[0].complete();

    expect(state.calls).toBe(1);
  });

  it("completes queued consumers and drops the queue on stop()", () => {
    const { state, upstream } = tracked();
    const loader = batchLoader<number, number>(bufferTime(10, undefined, 1), upstream, () => true, undefined, {
      maxConcurrentBatches: 1,
    });

    subscribeSpyTo(loader(1));
    const queued = subscribeSpyTo(loader(2));
    loader.stop();

    expect(queued.receivedComplete()).toBe(true);
    expect(state.calls).toBe(1);
    expect(state.active).toBe(0);
  });

  it("passes events through the output operator after consumers unsubscribe", () => {
    const { state, upstream } = tracked();
    const stored: number[] = [];
    const loader = batchLoader<number, number>(
      bufferTime(10),
      upstream,
      () => true,
      tap((n) => stored.push(n)),
    );

    const spy = subscribeSpyTo(loader(1));
    vi.advanceTimersByTime(10);
    spy.unsubscribe();
    state.subjects[0].next(10);

    expect(stored).toEqual([10]);
  });
});
