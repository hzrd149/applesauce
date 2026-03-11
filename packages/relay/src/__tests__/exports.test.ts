import { describe, expect, it } from "vitest";
import * as exports from "../index.js";

describe("exports", () => {
  it("should export the expected functions", () => {
    expect(Object.keys(exports).sort()).toMatchInlineSnapshot(`
      [
        "AuthRequiredError",
        "Relay",
        "RelayClosedError",
        "RelayGroup",
        "RelayLiveness",
        "RelayManagement",
        "RelayManagementError",
        "RelayPool",
        "SyncDirection",
        "completeOnEose",
        "ignoreUnhealthyMailboxes",
        "ignoreUnhealthyRelays",
        "ignoreUnhealthyRelaysOnPointers",
        "onlyEvents",
        "reverseSwitchMap",
        "storeEvents",
      ]
    `);
  });
});
