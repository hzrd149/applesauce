import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventStore } from "../event-store.js";

describe("EventStore.dispose", () => {
  it("completes the insert$/update$/remove$ streams", () => {
    const store = new EventStore();
    const completed: string[] = [];
    store.insert$.subscribe({ complete: () => completed.push("insert") });
    store.update$.subscribe({ complete: () => completed.push("update") });
    store.remove$.subscribe({ complete: () => completed.push("remove") });

    store.dispose();

    expect(completed.sort()).toEqual(["insert", "remove", "update"]);
  });

  it("disposes and detaches a disposable event loader", () => {
    const store = new EventStore();
    const dispose = vi.fn();
    // Stand-in for a loader created by createEventLoaderForStore
    const loader = Object.assign(() => undefined as any, { [Symbol.dispose]: dispose });
    store.eventLoader = loader as any;

    store.dispose();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(store.eventLoader).toBeUndefined();
  });

  it("works with the `using` keyword via Symbol.dispose", () => {
    let completed = false;
    {
      using store = new EventStore();
      store.insert$.subscribe({ complete: () => (completed = true) });
      expect(completed).toBe(false);
    }
    // Exiting the block calls store[Symbol.dispose]() which completes the streams
    expect(completed).toBe(true);
  });

  describe("model keep-warm timers", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
    });

    it("flushes pending keep-warm timers immediately on dispose", () => {
      const store = new EventStore();

      // Subscribe then unsubscribe a model -> schedules a keep-warm timer
      const sub = store.timeline([{ kinds: [1] }]).subscribe();
      sub.unsubscribe();

      const pending = vi.getTimerCount();
      expect(pending).toBeGreaterThan(0); // keep-warm timer is running

      store.dispose();

      expect(vi.getTimerCount()).toBeLessThan(pending); // keep-warm timer was cancelled
    });

    it("completes active model subscriptions on dispose", () => {
      const store = new EventStore();
      let completed = false;
      store.timeline([{ kinds: [1] }]).subscribe({ complete: () => (completed = true) });

      store.dispose();

      expect(completed).toBe(true);
    });
  });
});
