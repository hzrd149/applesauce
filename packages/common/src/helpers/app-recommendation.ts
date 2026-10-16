import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getReplaceableIdentifier, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { AddressPointer, getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { processTags } from "applesauce-core/helpers/tags";
import { APP_HANDLER_KIND, HandlerLinkPlatform } from "./app-handler.js";

/** The event kind for NIP-89 handler recommendations */
export const APP_RECOMMENDATION_KIND = kinds.Handlerrecommendation;
/** A validated NIP-89 handler recommendation event */
export type AppRecommendationEvent = KnownEvent<typeof APP_RECOMMENDATION_KIND>;

/** A handler recommended for an event kind */
export interface RecommendedHandler {
  /** The handler information address */
  pointer: AddressPointer;
  /** The platform the recommendation applies to */
  platform?: HandlerLinkPlatform;
}

const HandlersSymbol = Symbol.for("app-recommendation-handlers");

/** Returns a relay filter for recommendations for an event kind, optionally from a set of authors */
export function getAppRecommendationsFilter(kind: number, authors?: string[]): Filter {
  return { kinds: [APP_RECOMMENDATION_KIND], "#d": [String(kind)], ...(authors ? { authors } : {}) };
}

/** Checks if an event is a valid NIP-89 handler recommendation (kind 31989) for a numeric event kind */
export function isValidAppRecommendation(event?: NostrEvent): event is AppRecommendationEvent {
  return !!event && event.kind === APP_RECOMMENDATION_KIND && /^\d+$/.test(getReplaceableIdentifier(event));
}

/** Returns the event kind the recommendation applies to */
export function getRecommendationKind(recommendation: AppRecommendationEvent): number;
export function getRecommendationKind(recommendation: NostrEvent): number | undefined;
export function getRecommendationKind(recommendation: NostrEvent): number | undefined {
  return isValidAppRecommendation(recommendation) ? parseInt(getReplaceableIdentifier(recommendation)) : undefined;
}

/** Returns the recommended handlers from the `a` tags */
export function getRecommendedHandlers(recommendation: NostrEvent): RecommendedHandler[] {
  return getOrComputeCachedValue(recommendation, HandlersSymbol, () =>
    processTags(recommendation.tags, (t) => {
      if (t[0] !== "a") return undefined;
      const pointer = getAddressPointerFromATag(t);
      if (pointer?.kind !== APP_HANDLER_KIND) return undefined;
      return t[3] ? { pointer, platform: t[3] as HandlerLinkPlatform } : { pointer };
    }),
  );
}
