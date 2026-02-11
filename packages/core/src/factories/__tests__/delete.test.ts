import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { DeleteFactory } from "../delete.js";

const user = new FakeUser();

describe("DeleteFactory", () => {
  describe("fromEvents", () => {
    it("should create a note factory from content", async () => {
      const events = [
        await user.note("hello world"),
        await user.note("hello world 2"),
        await user.note("hello world 3"),
      ];

      const factory = DeleteFactory.fromEvents(events);
      expect(factory).toBeInstanceOf(DeleteFactory);
      expect((await factory).tags).toEqual([["k", "1"], ...events.map((e) => ["e", e.id])]);
    });
  });
});
