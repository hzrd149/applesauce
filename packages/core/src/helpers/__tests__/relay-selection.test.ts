import { describe, expect, it } from "vitest";

import { selectOptimalRelays } from "../relay-selection.js";

const user = (pubkey: string, relays: string[]) => ({ pubkey, relays });

describe("selectOptimalRelays", () => {
  it("should stop selecting relays for a user once maxRelaysPerUser is reached", () => {
    const users = [user("a", ["r1", "r2", "r3"]), user("b", ["r1", "r2", "r3"]), user("c", ["r4"])];
    const selected = selectOptimalRelays(users, { maxConnections: 3, maxRelaysPerUser: 2 });

    // The third connection goes to the only relay that covers user c
    expect(selected.find((u) => u.pubkey === "c")?.relays).toEqual(["r4"]);
  });

  it("should not return more than maxRelaysPerUser relays for a user", () => {
    // r2 is selected for user b after user a already has r1
    const users = [user("a", ["r1", "r2"]), user("b", ["r2"]), user("c", ["r1"])];
    const selected = selectOptimalRelays(users, { maxConnections: 10, maxRelaysPerUser: 1 });

    for (const u of selected) expect(u.relays?.length).toBeLessThanOrEqual(1);
  });
});
