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

  describe("fromEvent", () => {
    it("should make a replaceable event newer than the one it replaces", async () => {
      const now = Math.floor(Date.now() / 1000);
      const list = user.event({ kind: 10000, created_at: now + 5 });

      const draft = await EventFactory.fromEvent(list);
      expect(draft.created_at).toBe(now + 6);
    });

    it("should use the current time when modifying an older replaceable event", async () => {
      const list = user.event({ kind: 10000, created_at: 1000 });

      const draft = await EventFactory.fromEvent(list);
      expect(draft.created_at).toBeGreaterThan(1001);
    });

    it("should use the current time for regular events", async () => {
      const now = Math.floor(Date.now() / 1000);
      const note = user.event({ kind: 1, created_at: now + 5 });

      const draft = await EventFactory.fromEvent(note);
      expect(draft.created_at).toBeLessThanOrEqual(now + 1);
    });
  });

  describe("clientTag", () => {
    it("should add a NIP-89 client tag", async () => {
      const event = await EventFactory.fromKind(1).clientTag("App", { pubkey: user.pubkey, identifier: "app" });
      expect(event.tags).toEqual([["client", "App", `31990:${user.pubkey}:app`]]);
    });
  });
});
