import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventFactory } from "../event.js";

const user = new FakeUser();

describe("EventFactory", () => {
  describe("basic chaining", () => {
    it("should chain methods and resolve to correct value", async () => {
      const event = await EventFactory.fromKind(1).content("hello world");
      expect(event.kind).toBe(1);
      expect(event.content).toBe("hello world");
      expect(event.tags).toEqual([]);
      expect(typeof event.created_at).toBe("number");
    });

    it("should allow custom created_at timestamp", async () => {
      const timestamp = 1234567890;
      const event = await EventFactory.fromKind(1).created(timestamp);
      expect(event.created_at).toBe(timestamp);
    });
  });
});
