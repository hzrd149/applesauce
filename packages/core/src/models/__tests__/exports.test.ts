import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "BlockedRelaysModel",
        "CalendarEventRSVPsModel",
        "CalendarEventsModel",
        "ChannelHiddenModel",
        "ChannelMessagesModel",
        "ChannelMetadataModel",
        "ChannelMutedModel",
        "CommentsModel",
        "ContactsModel",
        "EncryptedContentModel",
        "EventModel",
        "EventZapsModel",
        "EventsModel",
        "FavoriteRelaySetsModel",
        "FavoriteRelaysModel",
        "GiftWrapRumorModel",
        "GiftWrapsModel",
        "HiddenContactsModel",
        "HiddenMuteModel",
        "LegacyMessageReplies",
        "LegacyMessageThreads",
        "LegacyMessagesGroup",
        "LegacyMessagesGroups",
        "MailboxesModel",
        "MuteModel",
        "ProfileModel",
        "PublicContactsModel",
        "PublicMuteModel",
        "ReactionsModel",
        "ReceivedZapsModel",
        "ReplaceableModel",
        "ReplaceableSetModel",
        "RepliesModel",
        "SearchRelaysModel",
        "SentZapsModel",
        "ThreadModel",
        "TimelineModel",
        "UserBlossomServersModel",
        "UserBookmarkModel",
        "UserHiddenBookmarkModel",
        "UserPinnedModel",
        "UserPublicBookmarkModel",
        "WrappedMessageReplies",
        "WrappedMessageThreads",
        "WrappedMessagesGroup",
        "WrappedMessagesGroups",
        "WrappedMessagesModel",
      ]
    `);
  });
});
