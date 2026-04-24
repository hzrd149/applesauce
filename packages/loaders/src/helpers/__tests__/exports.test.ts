import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "IdentityStatus",
        "batchLoader",
        "consolidateEventPointers",
        "createFilterFromAddressPointers",
        "createFiltersFromAddressPointers",
        "getIdentitiesFromJson",
        "getIdentityFromJson",
        "groupAddressPointersByKind",
        "groupAddressPointersByPubkey",
        "groupAddressPointersByPubkeyOrKind",
        "isLoadableAddressPointer",
        "loadAsyncMap",
        "makeCacheRequest",
        "makeUpstreamRequest",
        "normalizeIdentityJson",
        "unwrap",
        "unwrapCacheRequest",
        "wrapUpstreamPool",
      ]
    `);
  });
});
