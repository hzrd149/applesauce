import { RumorStore } from "applesauce-core";
import { getEventHash, kinds, type Rumor } from "applesauce-core/helpers/event";
import { hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { EditionFactory } from "../../factories/control.js";
import { JoinLeaveFactory } from "../../factories/guestbook.js";
import type { RumorTemplate } from "../../types.js";
import { VSK } from "../../types.js";
import { createCommunity } from "../../helpers/community.js";
import { banlistLocator } from "../../helpers/crypto.js";
import { JOIN_VERB, LEAVE_VERB } from "../../helpers/guestbook.js";
import { ConcordCommunityStateModel, ConcordControlModel } from "../index.js";

const OWNER = "ab".repeat(32);
const ALICE = "11".repeat(32);
const BOB = "22".repeat(32);

function rumorFromTemplate(template: RumorTemplate, pubkey: string, ms = 1_000): Rumor {
  const tags = template.tags.filter((t) => t[0] !== "ms");
  tags.push(["ms", String(ms % 1000)]);
  const rumor: Rumor = {
    kind: template.kind,
    pubkey,
    content: template.content,
    tags,
    created_at: Math.floor(ms / 1000),
    id: "",
  };
  rumor.id = getEventHash(rumor);
  return rumor;
}

function add(store: RumorStore, rumor: Rumor): void {
  const added = store.add(rumor);
  if (!added) throw new Error("invalid test rumor");
}

describe("Concord models", () => {
  it("folds a control rumor store", async () => {
    const genesis = await createCommunity({ ownerPubkey: OWNER, name: "Test", description: "d", relays: ["wss://r"] });
    const control = new RumorStore();
    for (const template of genesis.controlRumors) add(control, rumorFromTemplate(template, OWNER));

    let channelNames: string[] = [];
    let communityId: string | undefined;
    control.model(ConcordControlModel, genesis.material).subscribe((s) => {
      communityId = s.material.community_id;
      channelNames = s.channels.map((c) => c.name);
    });

    expect(communityId).toBe(genesis.material.community_id);
    expect(channelNames).toContain("general");
  });

  it("combines control, guestbook, and observed authors into community state", async () => {
    const genesis = await createCommunity({ ownerPubkey: OWNER, name: "Test", relays: ["wss://r"] });
    const control = new RumorStore();
    const guestbook = new RumorStore();
    const channel = new RumorStore();
    for (const template of genesis.controlRumors) add(control, rumorFromTemplate(template, OWNER));

    add(guestbook, rumorFromTemplate(await JoinLeaveFactory.create(JOIN_VERB), ALICE, 2_000));
    add(guestbook, rumorFromTemplate(await JoinLeaveFactory.create(LEAVE_VERB), ALICE, 3_000));
    add(channel, rumorFromTemplate({ kind: kinds.ChatMessage, content: "present", tags: [] }, BOB, 4_000));

    let members = new Set<string>();
    control
      .model(ConcordCommunityStateModel, genesis.material, { guestbook, observed: [channel] }, 10_000)
      .subscribe((s) => {
        members = s.members;
      });

    expect(members.has(ALICE)).toBe(false);
    expect(members.has(BOB)).toBe(true);
  });

  it("removes banned observed authors from community state", async () => {
    const genesis = await createCommunity({ ownerPubkey: OWNER, name: "Test", relays: ["wss://r"] });
    const control = new RumorStore();
    const guestbook = new RumorStore();
    const channel = new RumorStore();
    for (const template of genesis.controlRumors) add(control, rumorFromTemplate(template, OWNER));

    const banlist = await EditionFactory.create({
      vsk: VSK.BANLIST,
      eid: banlistLocator(hexToBytes(genesis.material.community_id)),
      version: 1,
      content: JSON.stringify([BOB]),
    });
    add(control, rumorFromTemplate(banlist, OWNER, 2_000));
    add(channel, rumorFromTemplate({ kind: kinds.ChatMessage, content: "banned", tags: [] }, BOB, 4_000));

    let members = new Set<string>();
    control
      .model(ConcordCommunityStateModel, genesis.material, { guestbook, observed: [channel] }, 10_000)
      .subscribe((s) => {
        members = s.members;
      });

    expect(members.has(BOB)).toBe(false);
  });
});
