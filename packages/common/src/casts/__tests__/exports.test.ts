import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "Article",
        "BlockedRelays",
        "BookmarksList",
        "BookmarksSet",
        "CASTS_SYMBOL",
        "CAST_REF_SYMBOL",
        "CodeSnippet",
        "Comment",
        "EventCast",
        "FavoriteRelays",
        "GroupsList",
        "Mutes",
        "Note",
        "Profile",
        "Reaction",
        "RelayDiscovery",
        "RelayMonitor",
        "Report",
        "SearchRelays",
        "Share",
        "Stream",
        "StreamChatMessage",
        "Torrent",
        "User",
        "Zap",
        "castEvent",
        "castUser",
      ]
    `);
  });
});
