import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getReplaceableIdentifier, getTagValue, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

/** Thumbnail metadata defined by NIP-58 */
export type BadgeThumbnail = {
  url: string;
  width?: number;
  height?: number;
};

const BadgeHeroSymbol = Symbol.for("badge-hero-image");
const BadgeThumbnailsSymbol = Symbol.for("badge-thumbnails");

function parseDimension(value?: string): { width?: number; height?: number } {
  if (!value) return {};
  const [width, height] = value.split("x").map((v) => parseInt(v, 10));
  return {
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
  };
}

/** Type guard for a valid badge event */
export type BadgeEvent = KnownEvent<typeof kinds.BadgeDefinition>;

/**
 * Returns true if the event is a valid badge definition (kind 30009).
 * Validates kind and the required `d` tag identifier.
 */
export function isValidBadge(event?: NostrEvent): event is BadgeEvent {
  if (!event || event.kind !== kinds.BadgeDefinition) return false;
  const identifier = getReplaceableIdentifier(event);
  return !!identifier && identifier.length > 0;
}

/** Returns the `d` tag identifier for a badge definition. */
export function getBadgeIdentifier(event: BadgeEvent): string;
export function getBadgeIdentifier(event?: NostrEvent): string | undefined;
export function getBadgeIdentifier(event?: NostrEvent): string | undefined {
  if (!isValidBadge(event)) return undefined;
  return getReplaceableIdentifier(event) || undefined;
}

/** Returns the human-readable badge name (`name` tag). */
export function getBadgeName(event?: NostrEvent): string | undefined {
  if (!isValidBadge(event)) return undefined;
  return getTagValue(event, "name") || undefined;
}

/** Returns the long-form badge description (`description` tag). */
export function getBadgeDescription(event?: NostrEvent): string | undefined {
  if (!isValidBadge(event)) return undefined;
  return getTagValue(event, "description") || undefined;
}

/** Returns the hero image declared via the `image` tag. */
export function getBadgeHeroImage(event?: NostrEvent): BadgeThumbnail | undefined {
  if (!isValidBadge(event)) return undefined;
  return getOrComputeCachedValue(event, BadgeHeroSymbol, () => {
    const tag = event.tags.find((entry) => entry[0] === "image" && entry[1]);
    return tag ? { url: tag[1], ...parseDimension(tag[2]) } : undefined;
  });
}

/** Returns every thumbnail declared via `thumb` tags. */
export function getBadgeThumbnails(event?: NostrEvent): BadgeThumbnail[] {
  if (!isValidBadge(event)) return [];
  return getOrComputeCachedValue(event, BadgeThumbnailsSymbol, () =>
    event.tags.filter((tag) => tag[0] === "thumb" && tag[1]).map((tag) => ({ url: tag[1], ...parseDimension(tag[2]) })),
  );
}

/** Returns the preferred image for display (hero image or first thumbnail). */
export function getBadgeImage(event?: NostrEvent): BadgeThumbnail | undefined {
  return getBadgeHeroImage(event) ?? getBadgeThumbnails(event)[0];
}
