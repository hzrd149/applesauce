import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { TursoEventDatabase } from "../event-database.js";

let database: TursoEventDatabase;
let user: FakeUser;

beforeEach(async () => {
  database = await TursoEventDatabase.fromDatabase(":memory:");
  user = new FakeUser();
});

afterEach(async () => {
  await database.close();
});

describe("add", () => {
  it("should ignore duplicate tag values within a single event", async () => {
    const event = user.note("Hello World", {
      tags: [
        ["t", "meme"],
        ["t", "meme"],
      ],
    });

    await expect(database.add(event)).resolves.toBe(event);
    await expect(database.hasEvent(event.id)).resolves.toBe(true);
  });

  it("should handle duplicate events without throwing", async () => {
    const event = user.note("Hello World");

    await expect(database.add(event)).resolves.toBe(event);
    await expect(database.add({ ...event })).resolves.toEqual(expect.objectContaining({ id: event.id }));
  });

  it("should match tag values that contain colons", async () => {
    const address = `30023:${user.pubkey}:article`;
    const event = user.note("Hello World", { tags: [["a", address]] });
    await database.add(event);

    expect((await database.getByFilters({ "#a": [address] })).map((e) => e.id)).toEqual([event.id]);
  });
});

describe("getByFilters", () => {
  it("should only return events matching tag filters", async () => {
    const meme = user.note("meme", { tags: [["t", "meme"]] });
    const other = user.note("other", { tags: [["t", "other"]] });
    await database.add(meme);
    await database.add(other);

    expect((await database.getByFilters({ "#t": ["meme"] })).map((e) => e.id)).toEqual([meme.id]);
    await expect(database.getByFilters({ "#t": ["missing"] })).resolves.toEqual([]);
  });

  it("should require every value for AND tag filters", async () => {
    const both = user.note("both", { tags: [["t", "black"], ["t", "white"]] });
    const one = user.note("one", { tags: [["t", "black"]] });
    await database.add(both);
    await database.add(one);

    expect((await database.getByFilters({ "&t": ["black", "white"] })).map((e) => e.id)).toEqual([both.id]);
  });

  it("should throw for search filters", async () => {
    await expect(database.getByFilters({ search: "hello" } as any)).rejects.toThrow("Search is not supported");
  });
});

describe("replaceable events", () => {
  it("should return the latest version", async () => {
    const older = user.profile({ name: "old" }, { created_at: 100 });
    const newer = user.profile({ name: "new" }, { created_at: 200 });
    await database.add(older);
    await database.add(newer);

    expect((await database.getReplaceable(0, user.pubkey))?.id).toBe(newer.id);
    expect((await database.getReplaceableHistory(0, user.pubkey))?.map((e) => e.id)).toEqual([newer.id, older.id]);
  });
});

describe("remove", () => {
  const countTags = async () => (await database.db.get("SELECT COUNT(*) AS count FROM event_tags")).count;

  it("should remove tag rows with the event", async () => {
    const event = user.note("Hello World", { tags: [["t", "meme"]] });
    await database.add(event);
    expect(await countTags()).toBe(1);

    await expect(database.remove(event.id)).resolves.toBe(true);
    expect(await countTags()).toBe(0);
  });

  it("should remove tag rows when removing by filters", async () => {
    await database.add(user.note("Hello World", { tags: [["t", "meme"]] }));

    await expect(database.removeByFilters({ "#t": ["meme"] })).resolves.toBe(1);
    expect(await countTags()).toBe(0);
  });
});

describe("concurrency", () => {
  it("should store every event when adding concurrently", async () => {
    const events = Array.from({ length: 50 }, (_, i) => user.note(`Note ${i}`, { tags: [["t", "bulk"]] }));
    await Promise.all(events.map((event) => database.add(event)));

    expect(await database.getByFilters({ "#t": ["bulk"] })).toHaveLength(50);
  });
});
