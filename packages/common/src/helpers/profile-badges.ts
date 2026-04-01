import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
} from "applesauce-core/helpers/pointers";
import { isATag, isETag } from "applesauce-core/helpers/tags";

export const PROFILE_BADGES_KIND = 10008;
export const LEGACY_PROFILE_BADGES_IDENTIFIER = "profile_badges";

const ProfileBadgeSlotsSymbol = Symbol.for("profile-badge-slots");

/** Ordered pair connecting a badge definition to an accepted award */
export type ProfileBadgeSlot = {
  badge: AddressPointer;
  award: EventPointer;
};

/** Kind 10008 profile badges event */
export type ProfileBadgesEvent = KnownEvent<typeof PROFILE_BADGES_KIND>;

/** Legacy kind 30008 profile badges event (NIP-58 original spec) */
export type LegacyProfileBadgesEvent = KnownEvent<typeof kinds.ProfileBadges>;

/** Returns true if the event is a profile badges list (kind 10008 or legacy 30008 `profile_badges`). */
export function isValidProfileBadges(event?: NostrEvent): event is ProfileBadgesEvent | LegacyProfileBadgesEvent {
  if (!event) return false;
  if (event.kind === PROFILE_BADGES_KIND) return true;
  if (event.kind === kinds.ProfileBadges) {
    return event.tags.some((tag) => tag[0] === "d" && tag[1] === LEGACY_PROFILE_BADGES_IDENTIFIER);
  }
  return false;
}

/**
 * Extracts ordered profile badge slots from a badges event.
 * Each slot pairs an `a` tag (definition pointer) with the next `e` tag (award receipt).
 */
export function getProfileBadgeSlots(event?: NostrEvent): ProfileBadgeSlot[] {
  if (!isValidProfileBadges(event)) return [];

  return getOrComputeCachedValue(event, ProfileBadgeSlotsSymbol, () => {
    const slots: ProfileBadgeSlot[] = [];
    for (let i = 0; i < event.tags.length - 1; i++) {
      const aTag = event.tags[i];
      const eTag = event.tags[i + 1];
      if (!isATag(aTag) || !isETag(eTag)) continue;

      const definition = getAddressPointerFromATag(aTag);
      const award = getEventPointerFromETag(eTag);
      if (definition && award) {
        slots.push({ badge: definition, award });
        i += 1; // Skip the E tag we just consumed
      }
    }
    return slots;
  });
}

/** Chooses the most recent profile badge event between modern + legacy formats. */
export function compareProfileBadgeEvents(a?: NostrEvent, b?: NostrEvent): NostrEvent | undefined {
  if (!a) return b;
  if (!b) return a;
  return a.created_at >= b.created_at ? a : b;
}
