import { describe, expect, it } from "vitest";
import * as exports from "../../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "Calendar",
        "CalendarEvent",
        "CalendarRsvp",
        "Channel",
        "Client",
        "Comment",
        "Content",
        "Delete",
        "Geohash",
        "GiftWrap",
        "Groups",
        "Hashtags",
        "Highlight",
        "LegacyMessage",
        "List",
        "LiveStream",
        "Mailboxes",
        "Note",
        "PicturePost",
        "Poll",
        "Profile",
        "Reaction",
        "Stream",
        "StreamChat",
        "TagOperations",
        "WrappedMessage",
        "Zap",
        "includeAltTag",
        "includeNameValueTag",
        "includeReplaceableIdentifier",
        "includeSingletonTag",
        "modifyHiddenTags",
        "modifyPublicTags",
        "modifyTags",
        "setExpirationTimestamp",
        "setMetaTags",
        "setProtected",
        "sign",
        "stamp",
        "stripSignature",
        "stripStamp",
        "stripSymbols",
        "updateCreatedAt",
      ]
    `);
  });
});
