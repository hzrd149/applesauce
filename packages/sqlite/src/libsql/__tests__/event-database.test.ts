import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

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
});
