import { describe, expect, it } from "vitest";

import { VSK } from "../../types.js";
import { EditionFactory } from "../../factories/control.js";
import { createCommunity } from "../community.js";
import { foldControl } from "../control.js";
import { decoded } from "./test-utils.js";

describe("control fold", () => {
  it("folds owner genesis metadata + channel, drops unauthorized editions", async () => {
    const genesis = await createCommunity({ ownerPubkey: "ab".repeat(32), name: "Test", description: "d", relays: ["wss://r"] });
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));
    // An outsider trying to publish a metadata edition must be ignored.
    const rogue = await EditionFactory.create({ vsk: VSK.METADATA, eid: genesis.material.community_id, version: 2, content: JSON.stringify({ name: "Hijacked", relays: [] }) });
    events.push(decoded(rogue, "ff".repeat(32), 2_000));
    const state = foldControl(events, genesis.material);
    expect(state.metadata?.name).toBe("Test");
    expect(state.channels.map((c) => c.name)).toContain("general");
  });
});
