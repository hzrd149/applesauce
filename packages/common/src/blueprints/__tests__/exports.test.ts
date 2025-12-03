import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AppDataBlueprint",
        "CalendarBlueprint",
        "ChannelMessageBlueprint",
        "ChannelMessageReplyBlueprint",
        "CommentBlueprint",
        "DeleteBlueprint",
        "FileMetadataBlueprint",
        "FollowSetBlueprint",
        "GiftWrapBlueprint",
        "GroupMessageBlueprint",
        "HighlightBlueprint",
        "LegacyMessageBlueprint",
        "LegacyMessageReplyBlueprint",
        "LiveChatMessageBlueprint",
        "NoteBlueprint",
        "NoteReplyBlueprint",
        "PicturePostBlueprint",
        "PollBlueprint",
        "PollResponseBlueprint",
        "ProfileBlueprint",
        "ReactionBlueprint",
        "ShareBlueprint",
        "SingleChoicePollResponseBlueprint",
        "StreamChatMessage",
        "TorrentBlueprint",
        "WrappedMessageBlueprint",
        "WrappedMessageReplyBlueprint",
      ]
    `);
  });
});
