import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { PROFILE_BADGES_KIND } from "../../helpers/profile-badges.js";
import { ProfileBadgesFactory } from "../profile-badges.js";

const HEX = (char: string, length = 64) => char.repeat(length);

const slotA = {
  badge: { kind: kinds.BadgeDefinition, pubkey: HEX("1"), identifier: "alpha" },
  award: { id: HEX("a") },
};

const slotB = {
  badge: { kind: kinds.BadgeDefinition, pubkey: HEX("2"), identifier: "beta" },
  award: { id: HEX("b") },
};

describe("ProfileBadgesFactory", () => {
  it("builds a profile badges event", async () => {
    const event = await ProfileBadgesFactory.create().slots([slotA]).addSlot(slotB);

    expect(event.kind).toBe(PROFILE_BADGES_KIND);
    expect(event.tags).toEqual([
      ["a", `${slotA.badge.kind}:${slotA.badge.pubkey}:${slotA.badge.identifier}`],
      ["e", slotA.award.id],
      ["a", `${slotB.badge.kind}:${slotB.badge.pubkey}:${slotB.badge.identifier}`],
      ["e", slotB.award.id],
    ]);
  });

  it("modifies an existing profile badges event", async () => {
    const existing: NostrEvent = {
      kind: PROFILE_BADGES_KIND,
      id: HEX("c"),
      pubkey: HEX("d"),
      sig: HEX("b", 128),
      created_at: 1,
      content: "",
      tags: [
        ["a", `${slotA.badge.kind}:${slotA.badge.pubkey}:${slotA.badge.identifier}`],
        ["e", slotA.award.id],
        ["a", `${slotB.badge.kind}:${slotB.badge.pubkey}:${slotB.badge.identifier}`],
        ["e", slotB.award.id],
      ],
    };

    const result = await ProfileBadgesFactory.modify(existing)
      .removeByBadge(slotA.badge)
      .removeByAward(slotB.award)
      .clearSlots();

    expect(result.tags).toEqual([]);
  });
});
