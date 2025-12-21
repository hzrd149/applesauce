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
        "EventCast",
        "FavoriteRelays",
        "Mutes",
        "Note",
        "Profile",
        "Reaction",
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
