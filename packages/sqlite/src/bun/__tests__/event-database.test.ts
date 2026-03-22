import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";

const isBun = "Bun" in globalThis;
const describeIfBun = isBun ? describe : describe.skip;

let BunSqliteEventDatabase: (typeof import("../event-database.js"))["BunSqliteEventDatabase"];
let database: InstanceType<(typeof import("../event-database.js"))["BunSqliteEventDatabase"]>;
let user: FakeUser;

beforeAll(async () => {
  if (isBun) ({ BunSqliteEventDatabase } = await import("../event-database.js"));
});

beforeEach(() => {
  if (!isBun) return;
  database = new BunSqliteEventDatabase(":memory:");
  user = new FakeUser();
});

describeIfBun("add", () => {
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
