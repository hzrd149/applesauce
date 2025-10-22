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
        "createReactionsLoader",
        "createSocialGraphLoader",
        "createTagValueLoader",
        "createTimelineLoader",
        "createUserListsLoader",
        "createWindowTimelineLoader",
        "createZapsLoader",
        "eventLoadingSequence",
        "loadBackwardBlocks",
        "loadBlocksForWindow",
        "loadBlocksFromCache",
        "loadBlocksFromRelays",
        "loadEventsForTimelineWindow",
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
