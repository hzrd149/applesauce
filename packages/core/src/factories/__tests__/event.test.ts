import { describe, expect, it } from "vitest";
import { EventFactory } from "../event.js";
import { NoteFactory } from "../note.js";
import { FakeUser } from "../../__tests__/fixtures.js";

const user = new FakeUser();

describe("EventFactory", () => {
  describe("fromEvent", () => {
    it("should preserve the event type", async () => {
      const note = await user.note("testing");

      const factory = EventFactory.fromEvent(note);
      await expect(factory).resolves.toBe(note);
    });
  });

  describe("modify", () => {
    it("should cast the event into an event template", async () => {
      const note = await user.note("testing");
      const modified = EventFactory.modify(note);
      await expect(modified).resolves.toEqual({
        kind: note.kind,
        content: note.content,
        created_at: note.created_at,
        tags: note.tags,
      });
    });
  });

  describe("basic chaining", () => {
    it("should chain methods and resolve to correct value", async () => {
      const event = await EventFactory.fromKind(1).content("hello world").kind(2);
      expect(event.kind).toBe(2);
      expect(event.content).toBe("hello world");
      expect(event.tags).toEqual([]);
      expect(typeof event.created_at).toBe("number");
    });
    it("should allow custom created_at timestamp", async () => {
      const timestamp = 1234567890;
      const event = await EventFactory.fromKind(1).created(timestamp);
      expect(event.created_at).toBe(timestamp);
    });
    it("should create from existing event", async () => {
      const existingEvent = {
        id: "abc123",
        kind: 1,
        content: "test",
        tags: [["e", "xyz"]],
        created_at: 1000000,
        pubkey: "pubkey",
        sig: "sig",
      };
      const event = await EventFactory.fromEvent(existingEvent);
      expect(event).toEqual(existingEvent);
    });
  });
});

describe("NoteFactory", () => {
  describe("fromContent", () => {
    it("should create a note factory from content", async () => {
      const factory = NoteFactory.fromContent("hello world");
      expect(factory).toBeInstanceOf(NoteFactory);
      expect((await factory).content).toBe("hello world");
    });
  });
});
