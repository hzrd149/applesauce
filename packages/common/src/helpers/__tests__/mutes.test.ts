import { unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { isHiddenMutesUnlocked, MuteHiddenSymbol, Mutes, matchMutes } from "../mute.js";

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

// CR-02 regression: isHiddenMutesUnlocked used to be `MuteHiddenSymbol in mute ||
// isHiddenTagsUnlocked(mute)` — the presence of unlocked hidden TAGS (a different, lower-level
// symbol) was enough to report the mute event as "unlocked" (asserting T & UnlockedMutes),
// without ever deriving — or caching onto MuteHiddenSymbol — the actual MutedThings value. A
// consumer trusting the predicate and reading `mute[MuteHiddenSymbol]` directly would get
// `undefined`.
describe("isHiddenMutesUnlocked", () => {
  const user = new FakeUser();

  it("reports locked for an event whose hidden tags have not been unlocked", async () => {
    const hiddenTags = [["p", user.pubkey]];
    const mute = user.event({
      kind: 10000,
      tags: [],
      content: await user.nip04.encrypt(user.pubkey, JSON.stringify(hiddenTags)),
    });

    expect(isHiddenMutesUnlocked(mute)).toBe(false);
  });

  it("only reports unlocked once the muted-things value is actually derived, and caches it", async () => {
    const hiddenTags = [["p", user.pubkey]];
    const mute = user.event({
      kind: 10000,
      tags: [],
      content: await user.nip04.encrypt(user.pubkey, JSON.stringify(hiddenTags)),
    });

    // Unlock hidden tags directly (not through unlockHiddenMutes / getHiddenMutedThings) — this
    // is the exact first-call short-circuit shape: hidden tags are unlocked, but
    // MuteHiddenSymbol has never been derived or cached.
    await unlockHiddenTags(mute, user);
    expect(Reflect.has(mute, MuteHiddenSymbol)).toBe(false);

    // The guard must derive (and cache) the muted-things value as a side effect of reporting
    // "unlocked" — not just infer it from the lower-level hidden-tags symbol.
    expect(isHiddenMutesUnlocked(mute)).toBe(true);
    expect(Reflect.has(mute, MuteHiddenSymbol)).toBe(true);

    // Hand-derived expected value from the fixture's hidden "p" tag (NIP-51 mute list semantics).
    const expected = { pubkeys: new Set([user.pubkey]), threads: new Set(), hashtags: new Set(), words: new Set() };
    expect(Reflect.get(mute, MuteHiddenSymbol)).toEqual(expected);
  });
});
