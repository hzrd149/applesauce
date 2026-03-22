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
});
