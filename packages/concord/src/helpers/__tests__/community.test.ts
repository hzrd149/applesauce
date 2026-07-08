import { describe, expect, it } from "vitest";

import { createCommunity, deriveKeys, verifyOwner } from "../community.js";

describe("community keys", () => {
  it("createCommunity yields a verifiable owner proof and derivable keys", async () => {
    const genesis = await createCommunity({ ownerPubkey: "ab".repeat(32), name: "N", relays: ["wss://r"] });
    expect(verifyOwner(genesis.material)).toBe(true);
    const keys = deriveKeys(genesis.material, []);
    expect(keys.control.pk).toMatch(/^[0-9a-f]{64}$/);
    expect(keys.guestbook.pk).not.toBe(keys.control.pk);
  });
});
