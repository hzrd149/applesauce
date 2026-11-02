import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { NostrEvent, Rumor, StoreEvent } from "../../helpers/event.js";
import { Filter } from "../../helpers/filter.js";
import { AsyncEventStore } from "../async-event-store.js";
import { AsyncRumorStore } from "../async-rumor-store.js";
import { EventMemory } from "../event-memory.js";
import { EventStore } from "../event-store.js";
import { IAsyncEventDatabase } from "../interface.js";
import { RumorStore } from "../rumor-store.js";

const user = new FakeUser();

function asyncDatabase<E extends StoreEvent>(memory: EventMemory<E>): IAsyncEventDatabase<E> {
  return {
    add: async (event) => memory.add(structuredClone(event)),
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

async function checkStoreRemoval<E extends StoreEvent>(store: EventStore<E> | AsyncEventStore<E>, event: E) {
  try {
    const removed: E[] = [];
    store.remove$.subscribe((event) => removed.push(event));
    expect(await store.add(event)).toBe(event);

    expect(await store.remove(structuredClone(event))).toBe(true);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(event);

    // Check memory separately: async stores query the database, not their memory cache.
    expect(store.memory.getByFilters({ kinds: [event.kind] })).toEqual([]);
    expect(await store.getByFilters({ kinds: [event.kind] })).toEqual([]);
    expect(await store.getTimeline({ authors: [event.pubkey] })).toEqual([]);
    expect(await store.hasEvent(event.id)).toBe(false);
    expect(await store.getEvent(event.id)).toBeUndefined();
  } finally {
    store.dispose();
  }
}

describe("EventMemory.remove with a copied event", () => {
  const filters: [string, Filter][] = [
    ["all events", {}],
    ["id", { ids: [] }],
    ["kind", { kinds: [1] }],
    ["author", { authors: [user.pubkey] }],
    ["kind and author", { kinds: [1], authors: [user.pubkey] }],
    ["time", { since: 1, until: 1 }],
    ["tag", { "#t": ["remove-copy"] }],
  ];

  it.each(filters)("clears the %s query", (_name, filter) => {
    const memory = new EventMemory();
    const event = user.note("remove me", { created_at: 1, tags: [["t", "remove-copy"]] });
    const query = filter.ids ? { ids: [event.id] } : filter;
    memory.add(event);

    // Prime lazy tag indexes before removal.
    expect(memory.getByFilters(query)).toEqual([event]);
    expect(memory.remove(structuredClone(event))).toBe(true);

    expect(memory.size).toBe(0);
    expect(memory.hasEvent(event.id)).toBe(false);
    expect(memory.getEvent(event.id)).toBeUndefined();
    expect(memory.getByFilters(query)).toEqual([]);
    expect(memory.getTimeline(query)).toEqual([]);
    expect(memory.getSyncPairs(query)).toEqual([]);
    expect(memory.remove(structuredClone(event))).toBe(false);
  });

  it.each([0, 30000])("preserves other versions of replaceable kind %i", (kind) => {
    const memory = new EventMemory();
    const tags = kind === 30000 ? [["d", "identifier"]] : [];
    const identifier = kind === 30000 ? "identifier" : undefined;
    const older = user.event({ kind, created_at: 1, tags });
    const newer = user.event({ kind, created_at: 2, tags });
    memory.add(older);
    memory.add(newer);

    expect(memory.remove(structuredClone(newer))).toBe(true);
    expect(memory.getReplaceable(kind, user.pubkey, identifier)).toBe(older);
    expect(memory.getReplaceableHistory(kind, user.pubkey, identifier)).toEqual([older]);

    expect(memory.remove(structuredClone(older))).toBe(true);
    expect(memory.hasReplaceable(kind, user.pubkey, identifier)).toBe(false);
    expect(memory.getReplaceable(kind, user.pubkey, identifier)).toBeUndefined();
    expect(memory.getReplaceableHistory(kind, user.pubkey, identifier)).toBeUndefined();
  });

  it("clears claims on the stored instance", () => {
    const memory = new EventMemory();
    const event = memory.add(user.note());
    memory.claim(event);
    expect(memory.isClaimed(event)).toBe(true);

    expect(memory.remove(structuredClone(event))).toBe(true);
    expect(memory.isClaimed(event)).toBe(false);
  });

  it("does not leave duplicate index entries when re-adding a fresh copy", () => {
    const memory = new EventMemory();
    const event = memory.add(user.note());
    expect(memory.remove(structuredClone(event))).toBe(true);

    const replacement = memory.add(structuredClone(event));
    const indexed = memory.getByFilters({ kinds: [event.kind] });
    expect(indexed).toHaveLength(1);
    expect(indexed[0]).toBe(replacement);
    expect(Array.from(memory.iterateTime(undefined, undefined))).toEqual([replacement]);
  });
});

describe("store removal with a copied event", () => {
  it("keeps EventStore queries from restoring the event", async () => {
    await checkStoreRemoval(new EventStore(), user.note());
  });

  it("clears both EventStore memory and a separate database", async () => {
    await checkStoreRemoval(new EventStore({ database: new EventMemory() }), user.note());
  });

  it("keeps RumorStore queries from restoring the rumor", async () => {
    const { sig: _signature, ...rumor } = user.note();
    await checkStoreRemoval(new RumorStore(), rumor);
  });

  it("clears AsyncEventStore memory and a database holding separate instances", async () => {
    const database = asyncDatabase(new EventMemory<NostrEvent>());
    await checkStoreRemoval(new AsyncEventStore({ database }), user.note());
  });

  it("clears AsyncRumorStore memory and a database holding separate instances", async () => {
    const database = asyncDatabase(new EventMemory<Rumor>());
    const { sig: _signature, ...rumor } = user.note();
    await checkStoreRemoval(new AsyncRumorStore({ database }), rumor);
  });
});
