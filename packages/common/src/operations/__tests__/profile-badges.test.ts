import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import {
  addSlot,
  clearSlots,
  insertSlot,
  removeSlotByAward,
  removeSlotByBadge,
  setSlot,
  setSlots,
} from "../../operations/profile-badges";
import { PROFILE_BADGES_KIND } from "../../helpers/profile-badges";
import type { ProfileBadgeSlot } from "../../helpers/profile-badges";

const badgeA: ProfileBadgeSlot = {
  badge: { kind: kinds.BadgeDefinition, pubkey: "a".repeat(64), identifier: "alpha" },
  award: { id: "1".repeat(64) },
};

const badgeB: ProfileBadgeSlot = {
  badge: { kind: kinds.BadgeDefinition, pubkey: "b".repeat(64), identifier: "beta" },
  award: { id: "2".repeat(64) },
};

function createProfileBadgeDraft(tags: string[][] = []): EventTemplate {
  return {
    kind: PROFILE_BADGES_KIND,
    content: "",
    tags,
    created_at: unixNow(),
  };
}

function slotTags(slot: ProfileBadgeSlot): string[][] {
  return [
    ["a", `${slot.badge.kind}:${slot.badge.pubkey}:${slot.badge.identifier}`],
    ["e", slot.award.id],
  ];
}

describe("profile badge operations", () => {
  it("replaces slots", async () => {
    const draft = createProfileBadgeDraft(slotTags(badgeA));
    const updated = await setSlots([badgeB])(draft);
    expect(updated.tags).toEqual(slotTags(badgeB));
  });

  it("adds slots and replaces existing badge entries", async () => {
    const result = await addSlot(badgeA)(createProfileBadgeDraft());
    expect(result.tags).toEqual(slotTags(badgeA));

    const updatedAward = { id: "3".repeat(64) };
    const replaced = await addSlot({ badge: badgeA.badge, award: updatedAward })(result);
    expect(replaced.tags).toEqual(slotTags({ badge: badgeA.badge, award: updatedAward }));

    const appended = await addSlot(badgeB)(replaced);
    expect(appended.tags).toEqual([...slotTags({ badge: badgeA.badge, award: updatedAward }), ...slotTags(badgeB)]);
  });

  it("removes slots by badge or award", async () => {
    const draft = createProfileBadgeDraft([...slotTags(badgeA), ...slotTags(badgeB)]);
    const withoutBadgeA = await removeSlotByBadge(badgeA.badge)(draft);
    expect(withoutBadgeA.tags).toEqual(slotTags(badgeB));

    const withoutAwardB = await removeSlotByAward(badgeB.award)(withoutBadgeA);
    expect(withoutAwardB.tags).toHaveLength(0);
  });

  it("clears every slot", async () => {
    const draft = createProfileBadgeDraft([...slotTags(badgeA), ...slotTags(badgeB)]);
    const cleared = await clearSlots()(draft);
    expect(cleared.tags).toHaveLength(0);
  });

  it("inserts a slot at the beginning", async () => {
    const draft = createProfileBadgeDraft(slotTags(badgeA));
    const updated = await insertSlot(0, badgeB)(draft);
    expect(updated.tags).toEqual([...slotTags(badgeB), ...slotTags(badgeA)]);
  });

  it("inserts a slot at the end when index >= length", async () => {
    const draft = createProfileBadgeDraft(slotTags(badgeA));
    const updated = await insertSlot(5, badgeB)(draft);
    expect(updated.tags).toEqual([...slotTags(badgeA), ...slotTags(badgeB)]);
  });

  it("replaces a slot at a specific index", async () => {
    const badgeC: ProfileBadgeSlot = {
      badge: { kind: kinds.BadgeDefinition, pubkey: "c".repeat(64), identifier: "gamma" },
      award: { id: "3".repeat(64) },
    };
    const draft = createProfileBadgeDraft([...slotTags(badgeA), ...slotTags(badgeB)]);
    const updated = await setSlot(1, badgeC)(draft);
    expect(updated.tags).toEqual([...slotTags(badgeA), ...slotTags(badgeC)]);
  });

  it("throws when setSlot index is out of range", async () => {
    const draft = createProfileBadgeDraft(slotTags(badgeA));
    await expect(setSlot(2, badgeB)(draft)).rejects.toThrow("out of range");
  });
});
