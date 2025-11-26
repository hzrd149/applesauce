import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AppData",
        "Calendar",
        "CalendarEvent",
        "CalendarRsvp",
        "Channel",
        "Client",
        "Comment",
        "FileMetadata",
        "Geohash",
        "GiftWrap",
        "Groups",
        "Hashtags",
        "Highlight",
        "LegacyMessage",
        "List",
        "LiveStream",
        "MediaAttachment",
        "Note",
        "PicturePost",
        "Poll",
        "PollResponse",
        "Reaction",
        "Stream",
        "StreamChat",
        "TagOperations",
        "Torrent",
        "WrappedMessage",
        "Zap",
      ]
    `);
  });
});
