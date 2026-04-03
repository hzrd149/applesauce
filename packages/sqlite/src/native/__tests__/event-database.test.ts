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
});
