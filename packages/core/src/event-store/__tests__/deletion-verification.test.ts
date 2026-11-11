import { afterEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { kinds, NostrEvent } from "../../helpers/event.js";
import { AsyncDeleteManager } from "../async-delete-manager.js";
import { AsyncEventStore } from "../async-event-store.js";
import { DeleteManager } from "../delete-manager.js";
import { EventMemory } from "../event-memory.js";
import { EventStore, EventStoreOptions } from "../event-store.js";
import { IAsyncEventDatabase } from "../interface.js";

function memoryDatabase(): IAsyncEventDatabase {
  const memory = new EventMemory();
  return {
    add: async (event) => memory.add(event),
    remove: async (event) => memory.remove(event),
    removeByFilters: async (filters) => memory.removeByFilters(filters),
    hasEvent: async (id) => memory.hasEvent(id),
    getEvent: async (id) => memory.getEvent(id),
    hasReplaceable: async (kind, pubkey, identifier) => memory.hasReplaceable(kind, pubkey, identifier),
    getReplaceable: async (kind, pubkey, identifier) => memory.getReplaceable(kind, pubkey, identifier),
    getReplaceableHistory: async (kind, pubkey, identifier) => memory.getReplaceableHistory(kind, pubkey, identifier),
    getByFilters: async (filters) => memory.getByFilters(filters),
    getTimeline: async (filters) => memory.getTimeline(filters),
  };
}

const user = new FakeUser();

describe.each(["sync", "async"] as const)("%s store deletion verification", (mode) => {
  let store: EventStore | AsyncEventStore;

  function createStore(options?: Pick<EventStoreOptions, "verifyEvent">) {
    if (mode === "sync") {
      const deleteManager = new DeleteManager();
      store = new EventStore({ ...options, deleteManager });
      return deleteManager;
    }

    const deleteManager = new AsyncDeleteManager();
    store = new AsyncEventStore({ ...options, deleteManager, database: memoryDatabase() });
    return deleteManager;
  }

  afterEach(() => {
    store?.dispose();
    vi.restoreAllMocks();
  });

  function deletionFor(target: NostrEvent, tag: "e" | "a") {
    const pointer = tag === "e" ? target.id : `${target.kind}:${target.pubkey}:test`;
    const deletion = user.event({
      kind: kinds.EventDeletion,
      created_at: target.created_at + 1,
      tags: [[tag, pointer]],
    });

    // Relay input has no finalizeEvent verification memo, even after signature tampering.
    return JSON.parse(JSON.stringify(deletion)) as NostrEvent;
  }

  describe.each(["e", "a"] as const)("%s targets", (tag) => {
    function targetEvent() {
      return tag === "e" ? user.note() : user.event({ kind: 30000, tags: [["d", "test"]] });
    }

    it("rejects forged deletions without removing existing events", async () => {
      const manager = createStore();
      const processDeletion = vi.spyOn(manager, "add");
      const target = targetEvent();
      await store.add(target);
      const deletion = deletionFor(target, tag);
      deletion.sig = "0".repeat(128);

      expect(await store.add(deletion)).toBeNull();
      expect(processDeletion).not.toHaveBeenCalled();
      expect(await store.getEvent(target.id)).toEqual(target);
    });

    it("rejects forged deletions without blocking later insertion", async () => {
      createStore();
      const target = targetEvent();
      const deletion = deletionFor(target, tag);
      deletion.sig = "0".repeat(128);

      expect(await store.add(deletion)).toBeNull();
      await store.add(target);
      expect(await store.getEvent(target.id)).toEqual(target);
    });

    it("processes valid signed deletions", async () => {
      createStore();
      const target = targetEvent();
      await store.add(target);
      const deletion = deletionFor(target, tag);

      expect(await store.add(deletion)).toBe(deletion);
      // Async deletion notifications finish independently of add().
      await vi.waitFor(async () => expect(await store.hasEvent(target.id)).toBe(false));
      await store.add(target);
      expect(await store.hasEvent(target.id)).toBe(false);
    });
  });

  it.each([false, true])("honors a custom verifier returning %s", async (accepted) => {
    const verifyEvent = vi.fn(() => accepted);
    const manager = createStore({ verifyEvent });
    const processDeletion = vi.spyOn(manager, "add");
    const deletion = deletionFor(user.note(), "e");

    expect(await store.add(deletion)).toBe(accepted ? deletion : null);
    expect(verifyEvent).toHaveBeenCalledExactlyOnceWith(deletion);
    expect(processDeletion).toHaveBeenCalledTimes(accepted ? 1 : 0);
  });

  it("honors explicitly disabled verification", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = createStore({ verifyEvent: undefined });
    const processDeletion = vi.spyOn(manager, "add");
    const deletion = deletionFor(user.note(), "e");
    deletion.sig = "0".repeat(128);

    expect(await store.add(deletion)).toBe(deletion);
    expect(processDeletion).toHaveBeenCalledExactlyOnceWith(deletion);
  });
});
