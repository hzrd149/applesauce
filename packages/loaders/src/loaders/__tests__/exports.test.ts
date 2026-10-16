import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "DnsIdentityLoader",
        "RELAY_AUTH_ERROR_NAMES",
        "addressPointerLoadingSequence",
        "availabilityCountSource",
        "cacheAddressPointersLoader",
        "cacheEventsLoader",
        "cacheTagValueLoader",
        "consolidateAddressPointers",
        "countService",
        "createAddressLoader",
        "createCountRuntime",
        "createCountService",
        "createEventLoader",
        "createEventLoaderForStore",
        "createOutboxTimelineLoader",
        "createReactionsLoader",
        "createSocialGraphLoader",
        "createSyncLoader",
        "createTagValueLoader",
        "createTimelineLoader",
        "createUnifiedEventLoader",
        "createZapsLoader",
        "eventLoadingSequence",
        "fallbackCountSource",
        "legacyReferenceCountMetric",
        "loadBlocksFromCache",
        "loadBlocksFromFilterMap",
        "loadBlocksFromOutboxMap",
        "loadBlocksFromOutboxMapCache",
        "loadBlocksFromRelay",
        "loadBlocksFromRelays",
        "nip85CountSource",
        "reactionCountMetric",
        "relayCountSource",
        "relayEventsLoader",
        "relayHintsAddressPointersLoader",
        "relayHintsEventsLoader",
        "relaysAddressPointersLoader",
        "relaysEventsLoader",
        "relaysTagValueLoader",
        "rootCommentCountMetric",
        "roundRobinCountSource",
        "routingCountSource",
      ]
    `);
  });
});
