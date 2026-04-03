import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "Article",
        "AssertionProvider",
        "Badge",
        "BadgeAward",
        "BlockedRelays",
        "BookmarksList",
        "BookmarksSet",
        "CASTS_SYMBOL",
        "CAST_REF_SYMBOL",
        "CodeSnippet",
        "Comment",
        "EmojiPack",
        "EventCast",
        "FavoriteEmojis",
        "FavoriteRelays",
        "FileMetadata",
        "GroupsList",
        "Mutes",
        "Note",
        "Profile",
        "ProfileBadges",
        "PubkeyCast",
        "Reaction",
        "RelayDiscovery",
        "RelayMonitor",
        "Report",
        "SearchRelays",
        "Share",
        "Stream",
        "StreamChatMessage",
        "Torrent",
        "TrustedProviderList",
        "User",
        "UserAssertion",
        "Zap",
        "ZapGoal",
        "castEvent",
        "castPubkey",
        "castTrustedProviders",
        "castUser",
      ]
    `);
  });
});
