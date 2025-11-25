import { describe, expect, it } from "vitest";
import { Mutes, matchMutes } from "../mutes.js";
import { FakeUser } from "../../__tests__/fixtures.js";

const mutedUser = new FakeUser();
const nonMutedUser = new FakeUser();

const thread = nonMutedUser.note("Hello world");

// Create a mutes object with a pubkey to mute
const mutes: Mutes = {
  pubkeys: new Set([mutedUser.pubkey]),
  threads: new Set([thread.id]),
  hashtags: new Set(["nostr"]),
  words: new Set(["GM"]),
};

describe("matchMutes", () => {
  it("should match events with muted pubkeys", () => {
    const mutedEvent = mutedUser.note("Hello world");
    const nonMutedEvent = nonMutedUser.note("Hello world");

    // The event with the muted pubkey should match
    expect(matchMutes(mutes, mutedEvent)).toBe(true);

    // The event with a different pubkey should not match
    expect(matchMutes(mutes, nonMutedEvent)).toBe(false);
  });

  it("should match events with muted hashtags", () => {
    // Create events with and without the muted hashtag
    const eventWithMutedHashtag = nonMutedUser.note("Hello world");
    eventWithMutedHashtag.tags.push(["t", "nostr"]);

    const eventWithDifferentHashtag = nonMutedUser.note("Hello world");
    eventWithDifferentHashtag.tags.push(["t", "bitcoin"]);

    const eventWithNoHashtag = nonMutedUser.note("Hello world");

    // The event with the muted hashtag should match
    expect(matchMutes(mutes, eventWithMutedHashtag)).toBe(true);

    // The events without the muted hashtag should not match
    expect(matchMutes(mutes, eventWithDifferentHashtag)).toBe(false);
    expect(matchMutes(mutes, eventWithNoHashtag)).toBe(false);
  });

  it("should match events within threads", () => {
    // Create a reply to the thread
    const reply = nonMutedUser.note("Hello world");
    reply.tags.push(["e", thread.id, "", "root"]);

    // The reply should match the mute
    expect(matchMutes(mutes, reply)).toBe(true);

    // The thread should not match the mute
    expect(matchMutes(mutes, thread)).toBe(false);
  });

  it("should match events with muted words", () => {
    // The event with the muted word should match
    expect(matchMutes(mutes, nonMutedUser.note("GM"))).toBe(true);

    // Should not match other words that contain the muted word
    expect(matchMutes(mutes, nonMutedUser.note("GMing"))).toBe(false);

    // Should be case-insensitive
    expect(matchMutes(mutes, nonMutedUser.note("gm"))).toBe(true);

    // Should match if the muted word
    expect(matchMutes(mutes, nonMutedUser.note("Hello GM world"))).toBe(true);
  });
});
