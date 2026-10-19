import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { LibsqlEventDatabase } from "../event-database.js";

let database: LibsqlEventDatabase;
let user: FakeUser;
let tempDir: string;

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "applesauce-libsql-"));
  database = new LibsqlEventDatabase(`file:${join(tempDir, "events.db")}`);
  await database.initialize();
  user = new FakeUser();
});

afterEach(() => {
  database.close();
  rmSync(tempDir, { recursive: true, force: true });
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

  it("should send the event and its tags in one batch", async () => {
    const batch = vi.spyOn(database.db, "batch");
    const transaction = vi.spyOn(database.db, "transaction");
    const event = user.note("Hello World", {
      tags: [
        ["t", "a"],
        ["t", "b"],
        ["p", user.pubkey],
      ],
    });

    await database.add(event);
    expect(batch).toHaveBeenCalledTimes(1);
    expect(batch.mock.calls[0][0]).toHaveLength(4);
    expect(transaction).not.toHaveBeenCalled();
    expect((await database.getByFilters({ "#t": ["b"] })).map((e) => e.id)).toEqual([event.id]);
  });

  it("should not index search content twice for duplicate events", async () => {
    const searchable = new LibsqlEventDatabase(`file:${join(tempDir, "search.db")}`, { search: true });
    await searchable.initialize();
    const event = user.note("Hello World");
    await searchable.add(event);
    await searchable.add({ ...event });

    const result = await searchable.db.execute("SELECT COUNT(*) AS count FROM events_search");
    expect(Number(result.rows[0].count)).toBe(1);
    expect((await searchable.getByFilters({ search: "Hello" })).map((e) => e.id)).toEqual([event.id]);
    searchable.close();
  });

  it("should match tag values that contain colons", async () => {
    const address = `30023:${user.pubkey}:article`;
    const event = user.note("Hello World", { tags: [["a", address]] });
    await database.add(event);

    expect((await database.getByFilters({ "#a": [address] })).map((e) => e.id)).toEqual([event.id]);
  });
});

describe("removeByFilters", () => {
  it("should remove search content for removed events", async () => {
    const searchable = new LibsqlEventDatabase(`file:${join(tempDir, "search.db")}`, { search: true });
    await searchable.initialize();
    await searchable.add(user.note("Hello World"));

    await expect(searchable.removeByFilters({ kinds: [1] })).resolves.toBe(1);
    const result = await searchable.db.execute("SELECT COUNT(*) AS count FROM events_search");
    expect(Number(result.rows[0].count)).toBe(0);
    searchable.close();
  });
});
