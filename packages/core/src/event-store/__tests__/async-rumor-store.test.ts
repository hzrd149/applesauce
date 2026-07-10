import { describe, expect, it } from "vitest";
import { getEventHash, kinds, Rumor } from "../../helpers/event.js";
import { Filter } from "../../helpers/filter.js";
import { IAsyncEventDatabase } from "../interface.js";
import { EventMemory } from "../event-memory.js";
import { AsyncRumorStore } from "../async-rumor-store.js";

/** Builds a valid rumor with a correctly recomputed `id`, overriding any fields as needed */
function makeRumor(overrides?: Partial<Omit<Rumor, "id">>): Rumor {
  const rumor: Rumor = {
    kind: overrides?.kind ?? kinds.ShortTextNote,
    pubkey: overrides?.pubkey ?? "a".repeat(64),
    created_at: overrides?.created_at ?? 1,
    content: overrides?.content ?? "hello rumor",
    tags: overrides?.tags ?? [],
    id: "",
  };
  rumor.id = getEventHash(rumor);
  return rumor;
}

/** A real (in-memory) async database backed by {@link EventMemory} so replaceable/delete/filter
 *  behavior is exercised end-to-end through the async store. */
function memoryDatabase(): IAsyncEventDatabase<Rumor> {
  const memory = new EventMemory<Rumor>();
  return {
    add: async (event) => memory.add(event),
    remove: async (event) => memory.remove(event),
    removeByFilters: async (filters: Filter | Filter[]) => memory.removeByFilters(filters),
    hasEvent: async (id) => memory.hasEvent(id),
    getEvent: async (id) => memory.getEvent(id),
    hasReplaceable: async (kind, pubkey, identifier) => memory.hasReplaceable(kind, pubkey, identifier),
    getReplaceable: async (kind, pubkey, identifier) => memory.getReplaceable(kind, pubkey, identifier),
    getReplaceableHistory: async (kind, pubkey, identifier) => memory.getReplaceableHistory(kind, pubkey, identifier),
    getByFilters: async (filters: Filter | Filter[]) => memory.getByFilters(filters),
    getTimeline: async (filters: Filter | Filter[]) => memory.getTimeline(filters),
  };
}

describe("AsyncRumorStore verification (RUMOR-03)", () => {
  it("accepts a rumor with a correct id", async () => {
    const store = new AsyncRumorStore({ database: memoryDatabase() });
    const rumor = makeRumor();

    expect(await store.add(rumor)).not.toBeNull();
  });

  it("rejects a rumor with an incorrect id", async () => {
    const store = new AsyncRumorStore({ database: memoryDatabase() });
    const rumor = makeRumor();
    rumor.id = "0".repeat(64);

    expect(await store.add(rumor)).toBeNull();
  });
});

describe("AsyncRumorStore reads (RUMOR-04)", () => {
  it("getEvent returns the stored rumor", async () => {
    const store = new AsyncRumorStore({ database: memoryDatabase() });
    const rumor = makeRumor();
    await store.add(rumor);

    expect(await store.getEvent(rumor.id)).toEqual(rumor);
  });

  it("getReplaceable returns the latest replaceable rumor", async () => {
    const store = new AsyncRumorStore({ database: memoryDatabase() });
    const pubkey = "b".repeat(64);
    const older = makeRumor({ kind: kinds.Metadata, pubkey, created_at: 0, content: "old" });
    const newer = makeRumor({ kind: kinds.Metadata, pubkey, created_at: 100, content: "new" });
    await store.add(older);
    await store.add(newer);

    expect(await store.getReplaceable(kinds.Metadata, pubkey)).toEqual(newer);
  });
});

describe("AsyncRumorStore kind-5 delete (RUMOR-05)", () => {
  it("removes a stored rumor when a matching kind-5 delete rumor is added", async () => {
    const store = new AsyncRumorStore({ database: memoryDatabase() });
    const rumor = makeRumor();
    await store.add(rumor);
    expect(await store.getEvent(rumor.id)).toEqual(rumor);

    const deleteRumor = makeRumor({
      kind: kinds.EventDeletion,
      pubkey: rumor.pubkey,
      created_at: rumor.created_at + 1,
      content: "",
      tags: [["e", rumor.id]],
    });
    await store.add(deleteRumor);

    expect(await store.getEvent(rumor.id)).toBeUndefined();
  });
});
