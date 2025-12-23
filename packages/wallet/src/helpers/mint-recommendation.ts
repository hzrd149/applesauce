import {
  getAddressPointerFromATag,
  getOrComputeCachedValue,
  getTagValue,
  isATag,
  isHex,
  KnownEvent,
} from "applesauce-core/helpers";
import { getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { CASHU_MINT_INFO_KIND } from "./mint-info.js";

// NIP-87 Recommendation Event Kind
export const MINT_RECOMMENDATION_KIND = 38000;

// Type definitions
export type MintRecommendationEvent = KnownEvent<typeof MINT_RECOMMENDATION_KIND>;

// Symbols for caching computed values
export const RecommendationKindSymbol = Symbol.for("mint-recommendation-kind");
export const RecommendationURLSymbol = Symbol.for("mint-recommendation-url");
export const RecommendationAddressPointerSymbol = Symbol.for("mint-recommendation-address-pointer");

// ============================================================================
// Recommendation Event (kind:38000) Helpers
// ============================================================================

/**
 * Returns the recommended event kind from a kind:38000 recommendation event
 * This should be 38172 for cashu mints
 */
export function getRecommendationKind(event: MintRecommendationEvent): number;
export function getRecommendationKind(event: NostrEvent): number | undefined;
export function getRecommendationKind(event: NostrEvent): number | undefined {
  return getOrComputeCachedValue(event, RecommendationKindSymbol, () => {
    const kindStr = getTagValue(event, "k");
    if (!kindStr) return undefined;
    const kind = parseInt(kindStr, 10);
    return isNaN(kind) ? undefined : kind;
  });
}

/**
 * Returns the d-identifier from a kind:38000 recommendation event
 * This is the kind:38172 event identifier this event is recommending
 */
export function getRecommendationMintPubkey(event: NostrEvent): string | undefined {
  const identifier = getReplaceableIdentifier(event);
  if (!isHex(identifier)) return undefined;
  return identifier || undefined;
}

/**
 * Returns the URL from a kind:38000 recommendation event
 * This is an optional `u` tag that provides a recommended way to connect to the cashu mint
 * Each recommendation event recommends a single mint, so there is at most one `u` tag
 */
export function getRecommendationURL(event: MintRecommendationEvent): string | undefined;
export function getRecommendationURL(event: NostrEvent): string | undefined;
export function getRecommendationURL(event: NostrEvent): string | undefined {
  return getOrComputeCachedValue(event, RecommendationURLSymbol, () => {
    return getTagValue(event, "u");
  });
}

/**
 * Returns the address pointer from a kind:38000 recommendation event
 * This `a` tag points to the kind:38172 event of the cashu mint
 * The first value is the event identifier, the second value is a relay hint
 * Each recommendation event recommends a single mint, so there is at most one `a` tag
 */
export function getRecommendationAddressPointer(event: MintRecommendationEvent): AddressPointer | undefined;
export function getRecommendationAddressPointer(event: NostrEvent): AddressPointer | undefined;
export function getRecommendationAddressPointer(event: NostrEvent): AddressPointer | undefined {
  return getOrComputeCachedValue(event, RecommendationAddressPointerSymbol, () => {
    const tag = event.tags.find(isATag);
    return tag ? (getAddressPointerFromATag(tag) ?? undefined) : undefined;
  });
}

/**
 * Validates that an event is a proper kind:38000 recommendation event
 * Checks that the event is kind 38000, has the required `k` and `d` tags,
 * and that the `k` tag is 38172 (cashu mint kind)
 * Each recommendation event recommends a single cashu mint
 */
export function isValidMintRecommendation(event?: NostrEvent): event is MintRecommendationEvent {
  if (!event) return false;
  if (event.kind !== MINT_RECOMMENDATION_KIND) return false;
  const kind = getRecommendationKind(event);
  // Only cashu mints (kind 38172) are supported
  return kind === CASHU_MINT_INFO_KIND;
}
