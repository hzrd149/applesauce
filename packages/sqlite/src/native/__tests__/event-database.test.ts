import { EventStore } from "applesauce-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";

const nativeSqliteModule = await import("node:sqlite").catch(() => null);
const NativeSqliteEventDatabase = nativeSqliteModule
  ? (await import("../event-database.js")).NativeSqliteEventDatabase
  : undefined;

let database: InstanceType<(typeof import("../event-database.js"))["NativeSqliteEventDatabase"]>;
let user: FakeUser;

const describeIfNativeSqlite = NativeSqliteEventDatabase ? describe : describe.skip;

beforeEach(() => {
  if (!NativeSqliteEventDatabase) return;
  database = new NativeSqliteEventDatabase(":memory:");
  user = new FakeUser();
});

afterEach(() => {
  database?.db.close();
});

describeIfNativeSqlite("EventStore removal", () => {
  it.each([0, 3, 10000, 30000])("removes losing versions of kind %i and their tags", (kind) => {
    const store = new EventStore({ database });
    try {
      const tags = [["p", user.pubkey], ...(kind === 30000 ? [["d", "test"]] : [])];
      const older = user.event({ kind, created_at: 100, tags });
      const newer = user.event({ kind, created_at: 200, tags });
      const removed: string[] = [];
      store.remove$.subscribe((event) => removed.push(event.id));

      store.add(older);
      store.add(newer);

      expect(database.getByFilters({}).map((event) => event.id)).toEqual([newer.id]);
      const remainingTags = database.db
        .prepare("SELECT COUNT(*) AS count FROM event_tags WHERE event_id = ?")
        .get(older.id);
      expect(remainingTags?.count).toBe(0);
      expect(store.memory.hasEvent(older.id)).toBe(false);
      expect(removed).toEqual([older.id]);
    } finally {
      store.dispose();
    }
  });

  it.each(["e", "a"])("removes NIP-09 %s targets and their tags", (tag) => {
    const store = new EventStore({ database });
    try {
      const event = user.event({ kind: 30000, created_at: 100, tags: [["d", "test"]] });
      const target = tag === "e" ? event.id : `30000:${user.pubkey}:test`;
      store.add(event);
      store.add(user.event({ kind: 5, created_at: 200, tags: [[tag, target]] }));

      expect(database.hasEvent(event.id)).toBe(false);
      expect(database.db.prepare("SELECT COUNT(*) AS count FROM event_tags").get()?.count).toBe(0);
      expect(store.memory.hasEvent(event.id)).toBe(false);
    } finally {
      store.dispose();
    }
  });
});

describeIfNativeSqlite("add", () => {
  it("should ignore duplicate tag values within a single event", () => {
    const event = user.note("Hello World", {
      tags: [
        ["t", "meme"],
        ["t", "meme"],
      ],
    });

    expect(database.add(event)).toBe(event);
    expect(database.hasEvent(event.id)).toBe(true);
  });

  it("should handle duplicate events without throwing", () => {
    const event = user.note("Hello World");

    expect(database.add(event)).toBe(event);
    expect(database.add({ ...event })).toEqual(expect.objectContaining({ id: event.id }));
  });

  it("should match tag values that contain colons", () => {
    const address = `30023:${user.pubkey}:article`;
    const event = user.note("Hello World", { tags: [["a", address]] });
    database.add(event);

    expect(database.getByFilters({ "#a": [address] }).map((e) => e.id)).toEqual([event.id]);
  });
});

describeIfNativeSqlite("removeByFilters", () => {
  it("should remove search content for removed events", () => {
    const searchable = new NativeSqliteEventDatabase(":memory:", { search: true });
    searchable.add(user.note("Hello World"));

    expect(searchable.removeByFilters({ kinds: [1] })).toBe(1);
    expect({ ...searchable.db.prepare("SELECT COUNT(*) AS count FROM events_search").get() }).toEqual({ count: 0 });
  });
});
