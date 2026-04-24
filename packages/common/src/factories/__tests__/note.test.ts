import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { NoteFactory } from "../note.js";

const HEX = (char: string, length = 64) => char.repeat(length);
const author = new FakeUser();
const mentioned = new FakeUser();

describe("NoteFactory", () => {
  describe("create", () => {
    it("builds a blank short text note", async () => {
      const event = await NoteFactory.create();

      expect(event.kind).toBe(kinds.ShortTextNote);
      expect(event.content).toBe("");
      expect(event.tags).toEqual([]);
      expect(typeof event.created_at).toBe("number");
    });

    it("sets the content", async () => {
      const event = await NoteFactory.create("Hello world");

      expect(event.kind).toBe(kinds.ShortTextNote);
      expect(event.content).toBe("Hello world");
      expect(event.tags).toEqual([]);
    });

    it("extracts hashtags from content", async () => {
      const event = await NoteFactory.create("Hello #Nostr and #applesauce");

      expect(event.tags).toEqual([
        ["t", "nostr"],
        ["t", "applesauce"],
      ]);
    });

    it("adds a 'p' tag for pubkeys mentioned in the content", async () => {
      const event = await NoteFactory.create(`hey nostr:${npubEncode(mentioned.pubkey)}!`);

      expect(event.tags).toEqual([["p", mentioned.pubkey]]);
    });

    it("applies meta tag options", async () => {
      const event = await NoteFactory.create("hi", {
        alt: "Short text note",
        expiration: 1700000000,
        protected: true,
      });

      expect(event.tags).toEqual(
        expect.arrayContaining([["alt", "Short text note"], ["expiration", "1700000000"], ["-"]]),
      );
    });

    it("applies zap splits from options", async () => {
      const event = await NoteFactory.create("hi", {
        splits: [
          { pubkey: HEX("a"), weight: 1 },
          { pubkey: HEX("b"), weight: 2 },
        ],
      });

      expect(event.tags).toEqual([
        ["zap", HEX("a"), "", "1"],
        ["zap", HEX("b"), "", "2"],
      ]);
    });

    it("sets a content warning when requested", async () => {
      const event = await NoteFactory.create("spoiler", { contentWarning: "spoilers ahead" });

      expect(event.tags).toContainEqual(["content-warning", "spoilers ahead"]);
    });
  });

  describe("fluent methods", () => {
    it("adds a NIP-14 subject tag", async () => {
      const event = await NoteFactory.create("hi").subject("Intro");

      expect(event.tags).toContainEqual(["subject", "Intro"]);
    });

    it("normalizes hashtags added via addHashtag", async () => {
      const event = await NoteFactory.create().addHashtag("#Nostr").addHashtag("applesauce");

      expect(event.tags).toEqual([
        ["t", "nostr"],
        ["t", "applesauce"],
      ]);
    });

    it("adds multiple hashtags via hashtags", async () => {
      const event = await NoteFactory.create().hashtags(["Foo", "BAR", "baz"]);

      expect(event.tags).toEqual([
        ["t", "foo"],
        ["t", "bar"],
        ["t", "baz"],
      ]);
    });

    it("adds a mention tag for a pubkey string", async () => {
      const pubkey = HEX("1");
      const event = await NoteFactory.create().mention(pubkey);

      expect(event.tags).toEqual([["p", pubkey]]);
    });

    it("adds a mention tag for a profile pointer with a relay hint", async () => {
      const pointer = { pubkey: HEX("2"), relays: ["wss://relay.example.com"] };
      const event = await NoteFactory.create().mention(pointer);

      expect(event.tags).toEqual([["p", pointer.pubkey, "wss://relay.example.com"]]);
    });

    it("sets the text content via text()", async () => {
      const event = await NoteFactory.create().text("Hello #world");

      expect(event.content).toBe("Hello #world");
      expect(event.tags).toContainEqual(["t", "world"]);
    });
  });

  describe("reply", () => {
    it("throws if the parent is not a short text note", () => {
      const parent: NostrEvent = {
        ...author.event({ kind: kinds.Reaction, content: "+" }),
      };

      expect(() => NoteFactory.reply(parent, "thanks!")).toThrow(
        "Kind 1 replies should only be used to reply to kind 1 notes",
      );
    });

    it("tags the parent as both root and reply for a top-level reply", async () => {
      const parent = author.note("original post");
      const event = await NoteFactory.reply(parent, "nice post");

      expect(event.kind).toBe(kinds.ShortTextNote);
      expect(event.content).toBe("nice post");
      expect(event.tags).toEqual([
        ["e", parent.id, "", "root", parent.pubkey],
        ["e", parent.id, "", "reply", parent.pubkey],
        ["p", parent.pubkey],
      ]);
    });

    it("preserves the existing thread root when replying in a nested thread", async () => {
      const rootId = HEX("r");
      const rootPubkey = HEX("9");
      const parent = author.note("middle of a thread", {
        tags: [
          ["e", rootId, "", "root", rootPubkey],
          ["p", rootPubkey],
        ],
      });

      const event = await NoteFactory.reply(parent, "replying deeper");

      expect(event.tags).toEqual([
        ["e", rootId, "", "root", rootPubkey],
        ["e", parent.id, "", "reply", parent.pubkey],
        ["p", rootPubkey],
        ["p", parent.pubkey],
      ]);
    });

    it("copies non-mention 'p' tags from the parent and does not duplicate the author", async () => {
      const otherPubkey = HEX("3");
      const mentionPubkey = HEX("4");
      const parent = author.note("ping everyone", {
        tags: [
          ["p", otherPubkey],
          ["p", mentionPubkey, "", "mention"],
          ["p", author.pubkey],
        ],
      });

      const event = await NoteFactory.reply(parent, "on it");

      const pTags = event.tags.filter((t) => t[0] === "p");
      expect(pTags).toEqual([
        ["p", otherPubkey],
        ["p", author.pubkey],
      ]);
    });

    it("applies factory options to the reply", async () => {
      const parent = author.note("original");
      const event = await NoteFactory.reply(parent, "reply with alt", { alt: "A reply" });

      expect(event.content).toBe("reply with alt");
      expect(event.tags).toContainEqual(["alt", "A reply"]);
    });
  });
});
