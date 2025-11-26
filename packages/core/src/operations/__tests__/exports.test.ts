import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "TagOperations",
        "includeAltTag",
        "includeContentHashtags",
        "includeEmojis",
        "includeNameValueTag",
        "includeQuoteTags",
        "includeReplaceableIdentifier",
        "includeSingletonTag",
        "modifyHiddenTags",
        "modifyPublicTags",
        "modifyTags",
        "repairNostrLinks",
        "setClient",
        "setContent",
        "setContentWarning",
        "setEncryptedContent",
        "setExpirationTimestamp",
        "setHiddenContent",
        "setMetaTags",
        "setProtected",
        "setShortTextContent",
        "sign",
        "stamp",
        "stripSignature",
        "stripStamp",
        "stripSymbols",
        "tagPubkeyMentions",
        "updateCreatedAt",
      ]
    `);
  });
});
