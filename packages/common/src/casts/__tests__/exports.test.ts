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
        "Comment",
        "DirectMessageRelays",
        "EventCast",
        "FavoriteRelays",
        "Mutes",
        "Note",
        "Profile",
        "SearchRelays",
        "Share",
        "Stream",
        "StreamChatMessage",
        "User",
        "Zap",
        "castEvent",
        "castUser",
      ]
    `);
  });
});
