import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "DEFAULT_ELECTRUMX_SERVERS",
        "IdentityStatus",
        "batchLoader",
        "buildNameIndexScript",
        "consolidateEventPointers",
        "createFilterFromAddressPointers",
        "createFiltersFromAddressPointers",
        "electrumScriptHash",
        "extractNostrFromValue",
        "formatNamecoinAddress",
        "getIdentitiesFromJson",
        "getIdentityFromJson",
        "getIdentityFromNamecoinValue",
        "groupAddressPointersByKind",
        "groupAddressPointersByPubkey",
        "groupAddressPointersByPubkeyOrKind",
        "isDotBit",
        "isLoadableAddressPointer",
        "isNamecoinIdentifier",
        "loadAsyncMap",
        "makeCacheRequest",
        "makeUpstreamRequest",
        "normalizeIdentityJson",
        "parseNameUpdateScript",
        "parseNamecoinAddress",
        "unwrap",
        "unwrapCacheRequest",
        "wrapUpstreamPool",
      ]
    `);
  });
});
