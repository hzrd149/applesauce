import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AppData",
        "Badge",
        "BadgeAward",
        "Calendar",
        "CalendarEvent",
        "CalendarRsvp",
        "Channel",
        "ChatMessage",
        "Client",
        "CodeSnippet",
        "Comment",
        "FileMetadata",
        "ForumThread",
        "Geohash",
        "GiftWrap",
        "GitGraspList",
        "GitRepository",
        "Group",
        "Hashtags",
        "Highlight",
        "LegacyMessage",
        "List",
        "LiveStream",
        "MediaAttachment",
        "NostrWebToken",
        "Note",
        "PicturePost",
        "Poll",
        "PollResponse",
        "ProfileBadges",
        "Reaction",
        "Stream",
        "StreamChat",
        "TagOperations",
        "Torrent",
        "WrappedMessage",
        "Zap",
        "ZapGoal",
        "ZapRequest",
        "ZapSplit",
      ]
    `);
  });
});
