import { beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "applesauce-core/event-store";
import { kinds } from "applesauce-core/helpers";
import { castEvent } from "../cast.js";
import { BadgeDefinition } from "../badge-definition.js";
import { BadgeAward } from "../badge-award.js";
import { ProfileBadges } from "../profile-badges.js";
import { Profile } from "../profile.js";
import { FakeUser } from "../../__tests__/fixtures.js";
import { PROFILE_BADGES_KIND } from "../../helpers/badges.js";

describe("badge casts", () => {
  const issuer = new FakeUser();
  const recipient = new FakeUser();
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore();
  });

  function coordinate(identifier: string) {
    return `${kinds.BadgeDefinition}:${issuer.pubkey}:${identifier}`;
  }

  it("casts badge definition and award", () => {
    const badgeDefinition = store.add(
      issuer.event({
        kind: kinds.BadgeDefinition,
        tags: [
          ["d", "bravery"],
          ["name", "Bravery"],
          ["image", "https://example.com/image.png", "1024x1024"],
        ],
      }),
    )!;

    const award = store.add(
      issuer.event({
        kind: kinds.BadgeAward,
        tags: [
          ["a", coordinate("bravery")],
          ["p", recipient.pubkey],
        ],
      }),
    )!;

    const definitionCast = castEvent(badgeDefinition, BadgeDefinition, store);
    expect(definitionCast.image?.url).toContain("image");

    const awardCast = castEvent(award, BadgeAward, store);
    expect(awardCast.definition.identifier).toBe("bravery");
    expect(awardCast.recipients[0]).toBe(recipient.pubkey);
  });

  it("casts profile badges and resolves via profile getter", async () => {
    const badgeDefinition = store.add(
      issuer.event({
        kind: kinds.BadgeDefinition,
        tags: [
          ["d", "courage"],
          ["name", "Courage"],
        ],
      }),
    )!;

    const award = store.add(
      issuer.event({
        kind: kinds.BadgeAward,
        tags: [
          ["a", coordinate("courage")],
          ["p", recipient.pubkey],
        ],
      }),
    )!;

    const badgesEvent = store.add(
      recipient.event({
        kind: PROFILE_BADGES_KIND,
        tags: [
          ["a", coordinate("courage")],
          ["e", award.id],
        ],
      }),
    )!;

    const profileEvent = store.add(recipient.profile({ name: "Tester" }))!;
    const profile = castEvent(profileEvent, Profile, store);

    const profileBadges = (await profile.badges$.$first(1000))!;
    expect(profileBadges.count).toBe(1);

    const slot = profileBadges.slots[0];
    const definition = await profileBadges.definition$(slot).$first(1000);
    const awardCast = await profileBadges.award$(slot).$first(1000);

    expect(definition?.identifier).toBe("courage");
    expect(awardCast?.id).toBe(award.id);

    // Ensure cast can be obtained directly
    const profileBadgesCast = castEvent(badgesEvent, ProfileBadges, store);
    expect(profileBadgesCast.count).toBe(1);
  });
});
