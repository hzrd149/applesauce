import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "DnsIdentityLoader",
        "addressPointerLoadingSequence",
        "cacheAddressPointersLoader",
        "cacheEventsLoader",
        "cacheTagValueLoader",
        "consolidateAddressPointers",
        "createAddressLoader",
        "createCountScheduler",
        "createCountService",
        "createEventLoader",
        "createEventLoaderForStore",
        "createFilterMapTimelineLoader",
        "createOutboxTimelineLoader",
        "createReactionsLoader",
        "createSocialGraphLoader",
        "createSyncLoader",
        "createTagValueLoader",
        "createTimelineLoader",
        "createUnifiedEventLoader",
        "createZapsLoader",
        "eventLoadingSequence",
        "legacyReferenceCountMetric",
        "loadBlocksFromCache",
        "loadBlocksFromFilterMap",
        "loadBlocksFromOutboxMap",
        "loadBlocksFromOutboxMapCache",
        "loadBlocksFromRelay",
        "loadBlocksFromRelays",
        "reactionCountMetric",
        "relayEventsLoader",
        "relayHintsAddressPointersLoader",
        "relayHintsEventsLoader",
        "relaysAddressPointersLoader",
        "relaysEventsLoader",
        "relaysTagValueLoader",
        "rootCommentCountMetric",
      ]
    `);
  });
});
