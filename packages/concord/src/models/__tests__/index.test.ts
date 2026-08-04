import { RumorStore } from "applesauce-core";
import { getEventHash, kinds, type Rumor } from "applesauce-core/helpers/event";
import { hexToBytes } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";

import { EditionFactory } from "../../factories/control.js";
import { JoinLeaveFactory, KickFactory } from "../../factories/guestbook.js";
import type { RumorTemplate } from "../../types.js";
import { VSK } from "../../types.js";
import { createCommunity } from "../../helpers/community.js";
import { banlistLocator } from "../../helpers/crypto.js";
import { JOIN_VERB, LEAVE_VERB } from "../../helpers/guestbook.js";
import { VOICE_PRESENCE_JOINED_EXAMPLE } from "../../__tests__/cord-wire-fixtures.js";
import { ConcordCommunityStateModel, ConcordControlModel } from "../index.js";

const OWNER = "ab".repeat(32);
const ALICE = "11".repeat(32);
const BOB = "22".repeat(32);
const CAROL = "33".repeat(32);
const DAVE = "44".repeat(32);
const ERIN = "55".repeat(32);
const FRANK = "66".repeat(32);
const GRACE = "77".repeat(32);

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

  it("a voice-presence beacon does not resurrect a departed member", async () => {
    const genesis = await createCommunity({ ownerPubkey: OWNER, name: "Test", relays: ["wss://r"] });
    const control = new RumorStore();
    const guestbook = new RumorStore();
    const channel = new RumorStore();
    for (const template of genesis.controlRumors) add(control, rumorFromTemplate(template, OWNER));

    add(guestbook, rumorFromTemplate(await JoinLeaveFactory.create(JOIN_VERB), ALICE, 1_000));
    add(guestbook, rumorFromTemplate(await JoinLeaveFactory.create(LEAVE_VERB), ALICE, 2_000));
    // A voice-presence beacon (kind 23313, sourced from the vendored spec fixture,
    // not our own VOICE_PRESENCE_KIND constant) newer than the Leave.
    add(
      channel,
      rumorFromTemplate(
        { kind: VOICE_PRESENCE_JOINED_EXAMPLE.kind, content: VOICE_PRESENCE_JOINED_EXAMPLE.content, tags: [] },
        ALICE,
        3_000,
      ),
    );

    let members = new Set<string>();
    control
      .model(ConcordCommunityStateModel, genesis.material, { guestbook, observed: [channel] }, 10_000)
      .subscribe((s) => {
        members = s.members;
      });

    expect(members.has(ALICE)).toBe(false);
  });

  it("a durable message still re-adds a departed member (mirror of the beacon case)", async () => {
    const genesis = await createCommunity({ ownerPubkey: OWNER, name: "Test", relays: ["wss://r"] });
    const control = new RumorStore();
    const guestbook = new RumorStore();
    const channel = new RumorStore();
    for (const template of genesis.controlRumors) add(control, rumorFromTemplate(template, OWNER));

    add(guestbook, rumorFromTemplate(await JoinLeaveFactory.create(JOIN_VERB), ALICE, 1_000));
    add(guestbook, rumorFromTemplate(await JoinLeaveFactory.create(LEAVE_VERB), ALICE, 2_000));
    // Identical fixture to the beacon case above, differing in exactly one
    // variable: a durable chat message instead of an ephemeral beacon.
    add(channel, rumorFromTemplate({ kind: kinds.ChatMessage, content: "present", tags: [] }, ALICE, 3_000));

    let members = new Set<string>();
    control
      .model(ConcordCommunityStateModel, genesis.material, { guestbook, observed: [channel] }, 10_000)
      .subscribe((s) => {
        members = s.members;
      });

    expect(members.has(ALICE)).toBe(true);
  });

  it("a voice-presence beacon does not resurrect a kicked member", async () => {
    const genesis = await createCommunity({ ownerPubkey: OWNER, name: "Test", relays: ["wss://r"] });
    const control = new RumorStore();
    const guestbook = new RumorStore();
    const channel = new RumorStore();
    for (const template of genesis.controlRumors) add(control, rumorFromTemplate(template, OWNER));

    add(guestbook, rumorFromTemplate(await JoinLeaveFactory.create(JOIN_VERB), ALICE, 1_000));
    // Owner is position 0 with every permission and vacVerifier exempts the
    // owner, so this Kick is honored with no `vac` tag.
    add(guestbook, rumorFromTemplate(await KickFactory.create(ALICE), OWNER, 2_000));
    add(
      channel,
      rumorFromTemplate(
        { kind: VOICE_PRESENCE_JOINED_EXAMPLE.kind, content: VOICE_PRESENCE_JOINED_EXAMPLE.content, tags: [] },
        ALICE,
        3_000,
      ),
    );

    let members = new Set<string>();
    control
      .model(ConcordCommunityStateModel, genesis.material, { guestbook, observed: [channel] }, 10_000)
      .subscribe((s) => {
        members = s.members;
      });

    expect(members.has(ALICE)).toBe(false);
  });

  it("excludes the ephemeral kind range (20000-29999) by NIP-01 boundary, not enumeration", async () => {
    const genesis = await createCommunity({ ownerPubkey: OWNER, name: "Test", relays: ["wss://r"] });
    const control = new RumorStore();
    const guestbook = new RumorStore();
    const channel = new RumorStore();
    for (const template of genesis.controlRumors) add(control, rumorFromTemplate(template, OWNER));

    // Five fresh pubkeys with no guestbook history: each reaches `members` only
    // through the observed loop's `!c` branch, one variable at a time — the
    // range boundary, not our own isEphemeralKind, is what's under test.
    const below = CAROL; // 19999 — regular, below the ephemeral range
    const lowerBound = DAVE; // 20000 — ephemeral, inclusive lower bound
    const mid = ERIN; // 23313 — ephemeral, the voice-presence beacon kind
    const upperBound = FRANK; // 29999 — ephemeral, inclusive upper bound
    const above = GRACE; // 30000 — addressable, above the ephemeral range

    add(channel, rumorFromTemplate({ kind: 19999, content: "", tags: [] }, below, 4_000));
    add(channel, rumorFromTemplate({ kind: 20000, content: "", tags: [] }, lowerBound, 4_000));
    add(channel, rumorFromTemplate({ kind: 23313, content: "", tags: [] }, mid, 4_000));
    add(channel, rumorFromTemplate({ kind: 29999, content: "", tags: [] }, upperBound, 4_000));
    add(channel, rumorFromTemplate({ kind: 30000, content: "", tags: [] }, above, 4_000));

    let members = new Set<string>();
    control
      .model(ConcordCommunityStateModel, genesis.material, { guestbook, observed: [channel] }, 10_000)
      .subscribe((s) => {
        members = s.members;
      });

    expect(members.has(below)).toBe(true);
    expect(members.has(lowerBound)).toBe(false);
    expect(members.has(mid)).toBe(false);
    expect(members.has(upperBound)).toBe(false);
    expect(members.has(above)).toBe(true);
  });
});
