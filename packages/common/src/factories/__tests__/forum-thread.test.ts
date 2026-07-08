import { kinds } from "applesauce-core/helpers/event";
import { npubEncode } from "applesauce-core/helpers/pointers";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { ForumThreadFactory } from "../forum-thread.js";
import { CommentFactory } from "../comment.js";

const author = new FakeUser();
const mentioned = new FakeUser();

describe("ForumThreadFactory", () => {
  it("builds a kind 11 thread with a title", async () => {
    const event = await ForumThreadFactory.create("GM", "Good morning");

    expect(event.kind).toBe(kinds.ForumThread);
    expect(event.content).toBe("Good morning");
    expect(event.tags).toContainEqual(["title", "GM"]);
  });

  it("allows a title-only thread", async () => {
    const event = await ForumThreadFactory.create("GM");

    expect(event.content).toBe("");
    expect(event.tags).toContainEqual(["title", "GM"]);
  });

  it("p-tags mentions and t-tags hashtags in the body", async () => {
    const event = await ForumThreadFactory.create("Topic", `hi nostr:${npubEncode(mentioned.pubkey)} #nostr`);

    expect(event.tags).toContainEqual(["p", mentioned.pubkey]);
    expect(event.tags).toContainEqual(["t", "nostr"]);
  });

  it("a NIP-22 comment replies to the thread root (NIP-7D)", async () => {
    const thread = author.event({ kind: kinds.ForumThread, content: "Good morning", tags: [["title", "GM"]] });
    const reply = await CommentFactory.create(thread, "Cool beans");

    expect(reply.kind).toBe(1111);
    expect(reply.tags).toContainEqual(["K", "11"]);
    expect(reply.tags.find((t) => t[0] === "E")?.[1]).toBe(thread.id);
  });
});
