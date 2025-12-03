import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "BlockedRelaysModel",
        "ContactsModel",
        "EncryptedContentModel",
        "EventModel",
        "FavoriteRelaySetsModel",
        "FavoriteRelaysModel",
        "FiltersModel",
        "HiddenContactsModel",
        "MailboxesModel",
        "OutboxModel",
        "ProfileModel",
        "PublicContactsModel",
        "ReplaceableModel",
        "SearchRelaysModel",
        "TimelineModel",
      ]
    `);
  });
});
