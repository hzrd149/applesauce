import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStoreSymbol, NostrEvent } from "../../helpers/event.js";
import { AsyncEventStore } from "../async-event-store.js";
import { IAsyncEventDatabase } from "../interface.js";

// Minimal async database stub — dispose() never touches the database, so no-ops are fine.
function fakeDatabase(): IAsyncEventDatabase {
  return {
    add: async (event: NostrEvent) => event,
    remove: async () => false,
    removeByFilters: async () => 0,
    hasEvent: async () => false,
    getEvent: async () => undefined,
    hasReplaceable: async () => false,
    getReplaceable: async () => undefined,
    getReplaceableHistory: async () => undefined,
    getByFilters: async () => [],
    getTimeline: async () => [],
  };
}

const user = new FakeUser();

describe("AsyncEventStore.add", () => {
  it("should store EventStoreSymbol non-enumerably on the added event", async () => {
    const store = new AsyncEventStore({ database: fakeDatabase() });
    const added = (await store.add(user.note("non-enumerable async store link")))!;

    expect(Reflect.get(added, EventStoreSymbol)).toBe(store);
    expect(Object.getOwnPropertyDescriptor(added, EventStoreSymbol)?.enumerable).toBe(false);
    // Object spread only copies enumerable own properties, so a non-enumerable
    // write must not ride along a spread of the stored event.
    expect(EventStoreSymbol in { ...added }).toBe(false);
  });
});

describe("AsyncEventStore.dispose", () => {
  describe("dispose", () => {
    it("completes the insert$/update$/remove$ streams", () => {
      const store = new AsyncEventStore({ database: fakeDatabase() });
      const completed: string[] = [];
      store.insert$.subscribe({ complete: () => completed.push("insert") });
      store.update$.subscribe({ complete: () => completed.push("update") });
      store.remove$.subscribe({ complete: () => completed.push("remove") });

      store.dispose();

      expect(completed.sort()).toEqual(["insert", "remove", "update"]);
    });

    it("disposes and detaches a disposable event loader", () => {
      const store = new AsyncEventStore({ database: fakeDatabase() });
      const dispose = vi.fn();
      const loader = Object.assign(() => undefined as any, { [Symbol.dispose]: dispose });
      store.eventLoader = loader as any;

      store.dispose();

      expect(dispose).toHaveBeenCalledTimes(1);
      expect(store.eventLoader).toBeUndefined();
    });

    it("works with the `using` keyword via Symbol.dispose", () => {
      let completed = false;
      {
        using store = new AsyncEventStore({ database: fakeDatabase() });
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
        const store = new AsyncEventStore({ database: fakeDatabase() });

        const sub = store.timeline([{ kinds: [1] }]).subscribe();
        sub.unsubscribe();

        const pending = vi.getTimerCount();
        expect(pending).toBeGreaterThan(0); // keep-warm timer is running

        store.dispose();

        expect(vi.getTimerCount()).toBeLessThan(pending); // keep-warm timer was cancelled
      });

      it("completes active model subscriptions on dispose", () => {
        const store = new AsyncEventStore({ database: fakeDatabase() });
        let completed = false;
        store.timeline([{ kinds: [1] }]).subscribe({ complete: () => (completed = true) });

        store.dispose();

        expect(completed).toBe(true);
      });
    });
  });
});
