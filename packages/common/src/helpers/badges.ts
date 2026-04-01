import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
} from "applesauce-core/helpers/pointers";
import { isATag, isETag } from "applesauce-core/helpers/tags";

/** Thumbnail metadata defined by NIP-58 */
export type BadgeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

/** Ordered pair connecting a badge definition to an accepted award */
export type ProfileBadgeSlot = {
  definition: AddressPointer;
  award: EventPointer;
};

export const PROFILE_BADGES_KIND = 10008;
export const LEGACY_PROFILE_BADGES_IDENTIFIER = "profile_badges";

const BadgeHeroSymbol = Symbol.for("badge-hero-image");
const BadgeThumbnailsSymbol = Symbol.for("badge-thumbnails");
const ProfileBadgeSlotsSymbol = Symbol.for("profile-badge-slots");

function parseDimension(value?: string): { width?: number; height?: number } {
  if (!value) return {};
  const [width, height] = value.split("x").map((v) => parseInt(v, 10));
  return {
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
  };
}

/** Returns true if the event is a badge definition (kind 30009). */
export function isBadgeDefinitionEvent(event?: NostrEvent): event is KnownEvent<typeof kinds.BadgeDefinition> {
  return !!event && event.kind === kinds.BadgeDefinition;
}

/** Returns the `d` tag identifier for a badge definition. */
export function getBadgeIdentifier(event?: NostrEvent): string | undefined {
  if (!isBadgeDefinitionEvent(event)) return undefined;
  const identifier = getTagValue(event, "d");
  return identifier && identifier.length > 0 ? identifier : undefined;
}

/** Returns the human-readable badge name (`name` tag). */
export function getBadgeName(event?: NostrEvent): string | undefined {
  if (!isBadgeDefinitionEvent(event)) return undefined;
  return getTagValue(event, "name") || undefined;
}

/** Returns the long-form badge description (`description` tag). */
export function getBadgeDescription(event?: NostrEvent): string | undefined {
  if (!isBadgeDefinitionEvent(event)) return undefined;
  return getTagValue(event, "description") || undefined;
}

/** Returns the hero image declared via the `image` tag. */
export function getBadgeHeroImage(event?: NostrEvent): BadgeThumbnail | undefined {
  if (!isBadgeDefinitionEvent(event)) return undefined;
  return getOrComputeCachedValue(event, BadgeHeroSymbol, () => {
    const tag = event.tags.find((entry) => entry[0] === "image" && entry[1]);
    return tag ? { url: tag[1], ...parseDimension(tag[2]) } : undefined;
  });
}

/** Returns every thumbnail declared via `thumb` tags. */
export function getBadgeThumbnails(event?: NostrEvent): BadgeThumbnail[] {
  if (!isBadgeDefinitionEvent(event)) return [];
  return getOrComputeCachedValue(event, BadgeThumbnailsSymbol, () =>
    event.tags.filter((tag) => tag[0] === "thumb" && tag[1]).map((tag) => ({ url: tag[1], ...parseDimension(tag[2]) })),
  );
}

/** Returns the preferred image for display (hero image or first thumbnail). */
export function getBadgeImage(event?: NostrEvent): BadgeThumbnail | undefined {
  return getBadgeHeroImage(event) ?? getBadgeThumbnails(event)[0];
}

/** Returns true if the event is a badge award (kind 8). */
export function isBadgeAwardEvent(event?: NostrEvent): event is KnownEvent<typeof kinds.BadgeAward> {
  return !!event && event.kind === kinds.BadgeAward;
}

/** Returns the definition pointer referenced by a badge award's first `a` tag. */
export function getBadgeAwardDefinitionPointer(event?: NostrEvent): AddressPointer | undefined {
  if (!isBadgeAwardEvent(event)) return undefined;
  const aTag = event.tags.find(isATag);
  return aTag ? (getAddressPointerFromATag(aTag) ?? undefined) : undefined;
}

/** Returns every recipient pubkey listed in the badge award's `p` tags. */
export function getBadgeAwardRecipients(event?: NostrEvent): string[] {
  if (!isBadgeAwardEvent(event)) return [];
  return event.tags.filter((tag) => tag[0] === "p" && tag[1]).map((tag) => tag[1]);
}

/** Returns true if the event is a profile badges list (kind 10008 or legacy 30008 `profile_badges`). */
export function isProfileBadgesEvent(event?: NostrEvent): event is NostrEvent {
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
  if (!isProfileBadgesEvent(event)) return [];

  return getOrComputeCachedValue(event, ProfileBadgeSlotsSymbol, () => {
    const slots: ProfileBadgeSlot[] = [];
    for (let i = 0; i < event.tags.length - 1; i++) {
      const aTag = event.tags[i];
      const eTag = event.tags[i + 1];
      if (!isATag(aTag) || !isETag(eTag)) continue;

      const definition = getAddressPointerFromATag(aTag);
      const award = getEventPointerFromETag(eTag);
      if (definition && award) {
        slots.push({ definition, award });
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
