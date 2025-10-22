import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "COMMON_LIST_KINDS",
        "COMMON_SET_KINDS",
        "DnsIdentityLoader",
        "addressPointerLoadingSequence",
        "cacheAddressPointersLoader",
        "cacheEventsLoader",
        "cacheTagValueLoader",
        "cacheTimelineLoader",
        "consolidateAddressPointers",
        "createAddressLoader",
        "createEventLoader",
        "createOutboxTimelineLoader",
        "createReactionsLoader",
        "createSocialGraphLoader",
        "createTagValueLoader",
        "createTimelineLoader",
        "createUserListsLoader",
        "createZapsLoader",
        "eventLoadingSequence",
        "loadBackwardBlocks",
        "loadBlocksForTimelineWindow",
        "loadBlocksFromCache",
        "loadBlocksFromFilterMap",
        "loadBlocksFromOutboxMap",
        "loadBlocksFromOutboxMapCache",
        "loadBlocksFromRelay",
        "loadBlocksFromRelays",
        "loadForwardBlocks",
        "relayEventsLoader",
        "relayHintsAddressPointersLoader",
        "relayHintsEventsLoader",
        "relaysAddressPointersLoader",
        "relaysEventsLoader",
        "relaysTagValueLoader",
        "relaysTimelineLoader",
      ]
    `);
  });
});
