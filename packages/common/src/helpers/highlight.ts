import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
  getProfilePointerFromPTag,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { isATag, isETag, isPTag } from "applesauce-core/helpers/tags";

// Symbol constants for caching
export const HighlightSourceEventPointerSymbol = Symbol.for("highlight-source-event-pointer");
export const HighlightSourceAddressPointerSymbol = Symbol.for("highlight-source-address-pointer");
export const HighlightAttributionSymbol = Symbol.for("highlight-attribution");

/**
 * Get the highlighted content from a highlight event
 * Returns the content field which contains the highlighted text
 */
export function getHighlightText(event: NostrEvent): string {
  return event.content;
}

/**
 * Get the source event pointer that was highlighted (from 'e' tag)
 * Returns undefined if no event reference is found
 */
export function getHighlightSourceEventPointer(event: NostrEvent): EventPointer | undefined {
  return getOrComputeCachedValue(event, HighlightSourceEventPointerSymbol, () => {
    const eTag = event.tags.find(isETag);
    return eTag ? (getEventPointerFromETag(eTag) ?? undefined) : undefined;
  });
}

/**
 * Get the source address pointer that was highlighted (from 'a' tag)
 * Returns undefined if no address reference is found
 */
export function getHighlightSourceAddressPointer(event: NostrEvent): AddressPointer | undefined {
  return getOrComputeCachedValue(event, HighlightSourceAddressPointerSymbol, () => {
    const aTag = event.tags.find(isATag);
    return aTag ? (getAddressPointerFromATag(aTag) ?? undefined) : undefined;
  });
}

/** Get the source URL that was highlighted (from 'r' tag) */
export function getHighlightSourceUrl(event: NostrEvent): string | undefined {
  return getTagValue(event, "r");
}

/** Role of an attributed profiles in a highlight */
export type HighlightAttributionRole = "author" | "editor" | "mention" | string;

/** Attribution information for a highlight */
export type HighlightAttribution = ProfilePointer & {
  /** Role of the attributed profile */
  role?: HighlightAttributionRole;
};

/**
 * Get attribution information from p tags
 * Parses p tags to extract authors, editors, and other attributed individuals
 */
export function getHighlightAttributions(event: NostrEvent): HighlightAttribution[] {
  return getOrComputeCachedValue(event, HighlightAttributionSymbol, () => {
    const attributions: HighlightAttribution[] = [];

    const pTags = event.tags.filter(isPTag);

    for (const pTag of pTags) {
      const pointer = getProfilePointerFromPTag(pTag);
      if (!pointer) continue;
      const role = pTag[3] || "other"; // Role is the 4th element (index 3)

      const entry: HighlightAttribution = { ...pointer, role };

      // Categorize by role
      attributions.push(entry);
    }

    return attributions;
  });
}

/**
 * Get the context text for a highlight (from 'context' tag)
 * This provides surrounding content to give context to the highlight
 */
export function getHighlightContext(event: NostrEvent): string | undefined {
  return getTagValue(event, "context");
}

/** Get the comment for a highlight (from 'comment' tag) */
export function getHighlightComment(event: NostrEvent): string | undefined {
  return getTagValue(event, "comment");
}

/**
 * Check if the highlight has any source reference (event, address, or URL)
 */
export function hasHighlightSource(event: NostrEvent): boolean {
  return !!(
    getHighlightSourceEventPointer(event) ||
    getHighlightSourceAddressPointer(event) ||
    getHighlightSourceUrl(event)
  );
}
