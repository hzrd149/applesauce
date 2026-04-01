import { kinds } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer } from "applesauce-core/helpers/pointers";
import { describe, expect, it } from "vitest";
import { getBadgeAwardPointer, getBadgeAwardRecipients } from "../badge-award.js";
import {
  getBadgeDescription,
  getBadgeHeroImage,
  getBadgeIdentifier,
  getBadgeImage,
  getBadgeName,
  getBadgeThumbnails,
} from "../badge.js";
import {
  compareProfileBadgeEvents,
  getProfileBadgeSlots,
  LEGACY_PROFILE_BADGES_IDENTIFIER,
  PROFILE_BADGES_KIND,
} from "../profile-badges.js";

function createEvent(
  partial: Partial<import("applesauce-core/helpers/event").NostrEvent>,
): import("applesauce-core/helpers/event").NostrEvent {
  return {
    id: partial.id ?? "id",
    pubkey: partial.pubkey ?? "pubkey".padStart(64, "0"),
    sig: partial.sig ?? "sig".padStart(128, "0"),
    created_at: partial.created_at ?? 1,
    kind: partial.kind ?? 1,
    content: partial.content ?? "",
    tags: partial.tags ?? [],
  };
}

describe("badge helpers", () => {
  it("reads badge definition tags", () => {
    const event = createEvent({
      kind: kinds.BadgeDefinition,
      tags: [
        ["d", "bravery"],
        ["name", "Bravery"],
        ["description", "Awarded for bravery"],
        ["image", "https://example.com/image.png", "1024x1024"],
        ["thumb", "https://example.com/thumb.png", "256x256"],
      ],
    });

    expect(getBadgeIdentifier(event)).toBe("bravery");
    expect(getBadgeName(event)).toBe("Bravery");
    expect(getBadgeDescription(event)).toBe("Awarded for bravery");
    expect(getBadgeHeroImage(event)?.width).toBe(1024);
    expect(getBadgeThumbnails(event)[0].height).toBe(256);
    expect(getBadgeImage(event)?.url).toContain("image");
  });

  it("reads badge award recipients and pointer", () => {
    const definition: AddressPointer = { kind: kinds.BadgeDefinition, pubkey: "a".repeat(64), identifier: "bravery" };
    const event = createEvent({
      kind: kinds.BadgeAward,
      tags: [
        ["a", `${definition.kind}:${definition.pubkey}:${definition.identifier}`],
        ["p", "b".repeat(64)],
        ["p", "c".repeat(64)],
      ],
    });

    expect(getBadgeAwardPointer(event)?.identifier).toBe("bravery");
    expect(getBadgeAwardRecipients(event)).toHaveLength(2);
  });

  it("parses profile badge slots for new kind", () => {
    const definition: AddressPointer = { kind: kinds.BadgeDefinition, pubkey: "a".repeat(64), identifier: "courage" };
    const award: EventPointer = { id: "1".repeat(64) };
    const event = createEvent({
      kind: PROFILE_BADGES_KIND,
      tags: [
        ["a", `${definition.kind}:${definition.pubkey}:${definition.identifier}`],
        ["e", award.id],
      ],
    });

    const slots = getProfileBadgeSlots(event);
    expect(slots).toHaveLength(1);
    expect(slots[0].badge.identifier).toBe("courage");
    expect(slots[0].award.id).toBe(award.id);
  });

  it("parses profile badge slots for legacy kind", () => {
    const event = createEvent({
      kind: kinds.ProfileBadges,
      tags: [
        ["d", LEGACY_PROFILE_BADGES_IDENTIFIER],
        ["a", `30009:${"a".repeat(64)}:bravery`],
        ["e", "f".repeat(64)],
      ],
    });

    const slots = getProfileBadgeSlots(event);
    expect(slots[0].award.id).toBe("f".repeat(64));
  });

  it("compares badge events", () => {
    const recent = createEvent({ kind: PROFILE_BADGES_KIND, created_at: 20 });
    const older = createEvent({ kind: PROFILE_BADGES_KIND, created_at: 10 });
    expect(compareProfileBadgeEvents(recent, older)).toBe(recent);
  });
});
