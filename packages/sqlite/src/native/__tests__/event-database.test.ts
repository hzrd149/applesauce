import { beforeEach, describe, expect, it } from "vitest";

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
