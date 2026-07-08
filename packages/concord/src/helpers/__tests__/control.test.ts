import { describe, expect, it } from "vitest";
import { hexToBytes } from "@noble/hashes/utils.js";

import { VSK } from "../../types.js";
import { EditionFactory } from "../../factories/control.js";
import { createCommunity } from "../community.js";
import { foldControl } from "../control.js";
import { inviteLinksLocator } from "../crypto.js";
import { decoded } from "./test-utils.js";

const OWNER = "ab".repeat(32);
const newCommunity = () => createCommunity({ ownerPubkey: OWNER, name: "Test", description: "d", relays: ["wss://r"] });

describe("control fold", () => {
  it("folds owner genesis metadata + channel, drops unauthorized editions", async () => {
    const genesis = await newCommunity();
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));
    // An outsider trying to publish a metadata edition must be ignored.
    const rogue = await EditionFactory.create({ vsk: VSK.METADATA, eid: genesis.material.community_id, version: 2, content: JSON.stringify({ name: "Hijacked", relays: [] }) });
    events.push(decoded(rogue, "ff".repeat(32), 2_000));
    const state = foldControl(events, genesis.material);
    expect(state.metadata?.name).toBe("Test");
    expect(state.channels.map((c) => c.name)).toContain("general");
  });

  it("folds the owner's invite registry (vsk 8) at its creator-bound coordinate", async () => {
    const genesis = await newCommunity();
    const cid = genesis.material.community_id;
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    const ownerEid = inviteLinksLocator(hexToBytes(cid), OWNER);
    const reg = await EditionFactory.create({ vsk: VSK.INVITE_REGISTRY, eid: ownerEid, version: 1, content: JSON.stringify(["11".repeat(32)]) });
    events.push(decoded(reg, genesis.material.owner, 2_000));

    // A registry published at someone else's coordinate is a forgery — ignored.
    const forged = await EditionFactory.create({ vsk: VSK.INVITE_REGISTRY, eid: "cc".repeat(32), version: 1, content: JSON.stringify(["22".repeat(32)]) });
    events.push(decoded(forged, genesis.material.owner, 3_000));

    const state = foldControl(events, genesis.material);
    expect(state.inviteLinks.has("11".repeat(32))).toBe(true);
    expect(state.inviteLinks.has("22".repeat(32))).toBe(false);
  });

  it("folds only the 100 lowest role_ids", async () => {
    const genesis = await newCommunity();
    const events = genesis.controlRumors.map((r) => decoded(r, genesis.material.owner));

    // 101 owner-signed roles with sortable ids "00…0000".."00…0064".
    for (let i = 0; i < 101; i++) {
      const roleId = i.toString(16).padStart(64, "0");
      const role = { role_id: roleId, name: `r${i}`, position: 5, permissions: "0", scope: { kind: "server" }, color: 0 };
      const ed = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });
      events.push(decoded(ed, genesis.material.owner, 2_000 + i));
    }

    const state = foldControl(events, genesis.material);
    expect(state.roles.length).toBe(100);
    // The dropped one is the highest id (index 100 = 0x64).
    expect(state.roles.some((r) => r.role_id === (100).toString(16).padStart(64, "0"))).toBe(false);
  });
});
