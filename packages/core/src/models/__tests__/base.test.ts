import { afterEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { AsyncEventStore } from "../../event-store/async-event-store.js";
import { EventMemory } from "../../event-store/event-memory.js";
import { EventStore } from "../../event-store/event-store.js";
import { IAsyncEventDatabase } from "../../event-store/interface.js";
import { RumorStore } from "../../event-store/rumor-store.js";
import { getEventHash, kinds, NostrEvent, Rumor, StoreEvent } from "../../helpers/event.js";
import { EventModel, FiltersModel, ReplaceableModel, TimelineModel } from "../base.js";

class AsyncMemoryDatabase<E extends StoreEvent> implements IAsyncEventDatabase<E> {
  memory = new EventMemory<E>();

  async add(event: E) {
    return this.memory.add(event);
  }
  async remove(event: string | E) {
    return this.memory.remove(event);
  }
  async removeByFilters(filters: Parameters<EventMemory<E>["removeByFilters"]>[0]) {
    return this.memory.removeByFilters(filters);
  }
  async hasEvent(id: string) {
    return this.memory.hasEvent(id);
  }
  async getEvent(id: string) {
    return this.memory.getEvent(id);
  }
  async hasReplaceable(kind: number, pubkey: string, identifier?: string) {
    return this.memory.hasReplaceable(kind, pubkey, identifier);
  }
  async getReplaceable(kind: number, pubkey: string, identifier?: string) {
    return this.memory.getReplaceable(kind, pubkey, identifier);
  }
  async getReplaceableHistory(kind: number, pubkey: string, identifier?: string) {
    return this.memory.getReplaceableHistory(kind, pubkey, identifier);
  }
  async getByFilters(filters: Parameters<EventMemory<E>["getByFilters"]>[0]) {
    return this.memory.getByFilters(filters);
  }
  async getTimeline(filters: Parameters<EventMemory<E>["getTimeline"]>[0]) {
    return this.memory.getTimeline(filters);
  }
  update(event: E) {
    this.memory.update(event);
  }
}

type TestStore<E extends StoreEvent> = {
  store: EventStore<E> | AsyncEventStore<E>;
  add(event: E): Promise<E | null>;
  remove(event: string | E): Promise<boolean>;
  dispose(): void;
};

type StoreCase<E extends StoreEvent> = {
  name: string;
  create(): TestStore<E>;
  makeEvent(overrides?: Partial<E>): E;
  makeReplaceable(overrides?: Partial<E>): E;
};

const user = new FakeUser();

function makeRumor(overrides?: Partial<Omit<Rumor, "id">>): Rumor {
  const rumor: Rumor = {
    kind: overrides?.kind ?? kinds.ShortTextNote,
    pubkey: overrides?.pubkey ?? "a".repeat(64),
    created_at: overrides?.created_at ?? 0,
    content: overrides?.content ?? "hello rumor",
    tags: overrides?.tags ?? [],
    id: "",
  };
  rumor.id = getEventHash(rumor);
  return rumor;
}

function createSyncStore<E extends StoreEvent>(): TestStore<E> {
  const store = new EventStore<E>({ verifyEvent: () => true });
  return {
    store,
    add: async (event) => store.add(event),
    remove: async (event) => store.remove(event),
    dispose: () => store.dispose(),
  };
}

function createAsyncStore<E extends StoreEvent>(): TestStore<E> {
  const store = new AsyncEventStore<E>({ database: new AsyncMemoryDatabase<E>(), verifyEvent: () => true });
  return {
    store,
    add: (event) => store.add(event),
    remove: (event) => store.remove(event),
    dispose: () => store.dispose(),
  };
}

function createRumorStore(): TestStore<Rumor> {
  const store = new RumorStore();
  return {
    store,
    add: async (event) => store.add(event),
    remove: async (event) => store.remove(event),
    dispose: () => store.dispose(),
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

const signedCases: StoreCase<NostrEvent>[] = [
  {
    name: "sync EventStore",
    create: createSyncStore,
    makeEvent: (overrides) => user.note(overrides?.content ?? "note", overrides),
    makeReplaceable: (overrides) => user.profile({ name: overrides?.content ?? "profile" }, overrides),
  },
  {
    name: "async EventStore",
    create: createAsyncStore,
    makeEvent: (overrides) => user.note(overrides?.content ?? "note", overrides),
    makeReplaceable: (overrides) => user.profile({ name: overrides?.content ?? "profile" }, overrides),
  },
];

const rumorCases: StoreCase<Rumor>[] = [
  {
    name: "RumorStore",
    create: createRumorStore,
    makeEvent: makeRumor,
    makeReplaceable: (overrides) => makeRumor({ kind: kinds.Metadata, ...overrides }),
  },
];

const cases: StoreCase<StoreEvent>[] = [...signedCases, ...rumorCases] as StoreCase<StoreEvent>[];
let stores: TestStore<StoreEvent>[] = [];

afterEach(() => {
  for (const store of stores) store.dispose();
  stores = [];
});

describe.each(cases)("base models with $name", ({ create, makeEvent, makeReplaceable }) => {
  function setup() {
    const testStore = create();
    stores.push(testStore);
    return testStore;
  }

  describe("EventModel", () => {
    it("emits an existing event and undefined when it is removed", async () => {
      const testStore = setup();
      const event = makeEvent({ created_at: 1, content: "event" });
      await testStore.add(event);

      const values: Array<StoreEvent | undefined> = [];
      const sub = EventModel<StoreEvent>(event.id)(testStore.store as any).subscribe((value) => values.push(value));
      await flush();

      expect(values).toEqual([event]);

      await testStore.remove(event);
      await flush();

      expect(values).toEqual([event, undefined]);
      sub.unsubscribe();
    });

    it("emits an inserted event when it was missing initially", async () => {
      const testStore = setup();
      const event = makeEvent({ created_at: 1, content: "late event" });

      const values: Array<StoreEvent | undefined> = [];
      const sub = EventModel<StoreEvent>(event.id)(testStore.store as any).subscribe((value) => values.push(value));
      await flush();

      expect(values).toEqual([undefined]);

      await testStore.add(event);
      await flush();

      expect(values).toEqual([undefined, event]);
      sub.unsubscribe();
    });
  });

  describe("ReplaceableModel", () => {
    it("emits the latest replaceable event and updates when a newer one is inserted", async () => {
      const testStore = setup();
      const older = makeReplaceable({ created_at: 1, content: "old" });
      const newer = makeReplaceable({ pubkey: older.pubkey, created_at: 2, content: "new" });
      await testStore.add(older);

      const values: Array<StoreEvent | undefined> = [];
      const sub = ReplaceableModel<StoreEvent>({ kind: kinds.Metadata, pubkey: older.pubkey })(
        testStore.store as any,
      ).subscribe((value) => values.push(value));
      await flush();

      expect(values).toEqual([older]);

      await testStore.add(newer);
      await flush();

      expect(values).toEqual([older, newer]);
      sub.unsubscribe();
    });

    it("emits undefined when the current replaceable event is removed", async () => {
      const testStore = setup();
      const event = makeReplaceable({ created_at: 1, content: "current" });
      await testStore.add(event);

      const values: Array<StoreEvent | undefined> = [];
      const sub = ReplaceableModel<StoreEvent>({ kind: kinds.Metadata, pubkey: event.pubkey })(
        testStore.store as any,
      ).subscribe((value) => values.push(value));
      await flush();

      await testStore.remove(event);
      await flush();

      expect(values).toEqual([event, undefined]);
      sub.unsubscribe();
    });
  });

  describe("TimelineModel", () => {
    it("emits an initial sorted timeline, inserts matches, and removes deleted events", async () => {
      const testStore = setup();
      const older = makeEvent({ created_at: 1, content: "older" });
      const newer = makeEvent({ created_at: 3, content: "newer" });
      const middle = makeEvent({ created_at: 2, content: "middle" });
      await testStore.add(older);
      await testStore.add(newer);

      const values: StoreEvent[][] = [];
      const sub = TimelineModel<StoreEvent>({ kinds: [kinds.ShortTextNote] })(testStore.store as any).subscribe(
        (value) => values.push(value),
      );
      await flush();

      expect(values.at(-1)?.map((event) => event.id)).toEqual([newer.id, older.id]);

      await testStore.add(middle);
      await flush();

      expect(values.at(-1)?.map((event) => event.id)).toEqual([newer.id, middle.id, older.id]);

      await testStore.remove(newer);
      await flush();

      expect(values.at(-1)?.map((event) => event.id)).toEqual([middle.id, older.id]);
      sub.unsubscribe();
    });
  });

  describe("FiltersModel", () => {
    it("emits existing and newly inserted matching events", async () => {
      const testStore = setup();
      const existing = makeEvent({ created_at: 1, content: "existing" });
      const inserted = makeEvent({ created_at: 2, content: "inserted" });
      await testStore.add(existing);

      const values: StoreEvent[] = [];
      const sub = FiltersModel<StoreEvent>({ kinds: [kinds.ShortTextNote] })(testStore.store as any).subscribe(
        (value) => values.push(value),
      );
      await flush();

      expect(values).toEqual([existing]);

      await testStore.add(inserted);
      await flush();

      expect(values).toEqual([existing, inserted]);
      sub.unsubscribe();
    });

    it("skips existing events when onlyNew is true", async () => {
      const testStore = setup();
      const existing = makeEvent({ created_at: 1, content: "existing" });
      const inserted = makeEvent({ created_at: 2, content: "inserted" });
      await testStore.add(existing);

      const values: StoreEvent[] = [];
      const sub = FiltersModel<StoreEvent>(
        { kinds: [kinds.ShortTextNote] },
        true,
      )(testStore.store as any).subscribe((value) => values.push(value));
      await flush();

      expect(values).toEqual([]);

      await testStore.add(inserted);
      await flush();

      expect(values).toEqual([inserted]);
      sub.unsubscribe();
    });
  });
});
