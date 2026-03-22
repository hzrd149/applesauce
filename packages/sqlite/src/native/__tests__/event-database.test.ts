import { beforeEach, describe, expect, it } from "vitest";

import { FakeUser } from "../../__tests__/fake-user.js";
import { NativeSqliteEventDatabase } from "../event-database.js";

let database: NativeSqliteEventDatabase;
let user: FakeUser;

beforeEach(() => {
  database = new NativeSqliteEventDatabase(":memory:");
  user = new FakeUser();
});

describe("add", () => {
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
