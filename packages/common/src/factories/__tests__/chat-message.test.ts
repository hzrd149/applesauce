import { kinds } from "applesauce-core/helpers/event";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { ChatMessageFactory } from "../chat-message.js";

const author = new FakeUser();
const mentioned = new FakeUser();

describe("ChatMessageFactory", () => {
  describe("create", () => {
    it("builds a blank kind 9 chat message", async () => {
      const event = await ChatMessageFactory.create();

      expect(event.kind).toBe(kinds.ChatMessage);
      expect(event.content).toBe("");
      expect(event.tags).toEqual([]);
    });

    it("sets the content", async () => {
      const event = await ChatMessageFactory.create("GM");

      expect(event.kind).toBe(kinds.ChatMessage);
      expect(event.content).toBe("GM");
    });

    it("p-tags pubkeys mentioned in the content", async () => {
      const event = await ChatMessageFactory.create(`hey nostr:${npubEncode(mentioned.pubkey)}!`);

      expect(event.tags).toEqual([["p", mentioned.pubkey]]);
    });
  });

  describe("reply", () => {
    it("adds a NIP-C7 'q' tag pointing at the parent", async () => {
      const parent = author.note("first message");
      const event = await ChatMessageFactory.reply(parent, "yes");

      expect(event.kind).toBe(kinds.ChatMessage);
      expect(event.content).toBe("yes");
      expect(event.tags).toContainEqual(["q", parent.id, "", parent.pubkey]);
    });

    it("accepts a lightweight event pointer", async () => {
      const event = await ChatMessageFactory.create("hi").replyTo({ id: "a".repeat(64), author: author.pubkey });

      expect(event.tags).toContainEqual(["q", "a".repeat(64), "", author.pubkey]);
    });
  });

  describe("attachments", () => {
    it("adds an imeta tag per attachment", async () => {
      const event = await ChatMessageFactory.create("look").attachments([
        { url: "https://example.com/a.png", type: "image/png" },
      ]);

      expect(event.tags).toContainEqual(["imeta", "url https://example.com/a.png", "m image/png"]);
    });
  });
});
