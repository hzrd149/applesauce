import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AuthHandlerError",
        "AuthRequiredError",
        "AuthTimeoutError",
        "Relay",
        "RelayAuthChallengeChangedError",
        "RelayAuthChallengeTimeoutError",
        "RelayClosedError",
        "RelayCountResponseError",
        "RelayCountTimeoutError",
        "RelayEventTimeoutError",
        "RelayEventVerdictError",
        "RelayGroup",
        "RelayLiveness",
        "RelayManagement",
        "RelayManagementError",
        "RelayPool",
        "SyncDirection",
        "completeOnEose",
        "estimateHllCardinality",
        "ignoreUnhealthyMailboxes",
        "ignoreUnhealthyRelays",
        "ignoreUnhealthyRelaysOnPointers",
        "isGroupReqProgress",
        "isReqProgress",
        "mergeHllRegisters",
        "onlyEvents",
        "reverseSwitchMap",
        "storeEvents",
      ]
    `);
  });
});
