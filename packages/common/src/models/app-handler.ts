import { Model } from "applesauce-core/event-store";
import { AddressPointer, getReplaceableAddressFromPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { combineLatest, map, of, switchMap } from "rxjs";
import { APP_HANDLER_KIND, AppHandlerEvent, getAppHandlersFilter, isValidAppHandler } from "../helpers/app-handler.js";
import {
  APP_RECOMMENDATION_KIND,
  AppRecommendationEvent,
  getAppRecommendationsFilter,
  getRecommendedHandlers,
  isValidAppRecommendation,
} from "../helpers/app-recommendation.js";

/** A handler ranked by the authors that recommend it */
export interface RankedAppHandler {
  /** The handler information event */
  handler: AppHandlerEvent;
  /** The pubkeys of the authors recommending the handler */
  recommenders: string[];
}

/** A model that returns NIP-89 handlers that advertise support for an event kind */
export function AppHandlersModel(kind: number): Model<AppHandlerEvent[]> {
  return (store) => store.timeline(getAppHandlersFilter(kind)).pipe(map((events) => events.filter(isValidAppHandler)));
}

/** A model that returns NIP-89 handler recommendations for an event kind, optionally from a set of authors */
export function AppRecommendationsModel(kind: number, authors?: string[]): Model<AppRecommendationEvent[]> {
  return (store) =>
    store
      .timeline(getAppRecommendationsFilter(kind, authors))
      .pipe(map((events) => events.filter(isValidAppRecommendation)));
}

/** A model that returns the handlers a user has published */
export function UserAppHandlersModel(user: string | ProfilePointer): Model<AppHandlerEvent[]> {
  const pubkey = typeof user === "string" ? user : user.pubkey;
  return (store) =>
    store
      .timeline({ kinds: [APP_HANDLER_KIND], authors: [pubkey] })
      .pipe(map((events) => events.filter(isValidAppHandler)));
}

/** A model that returns a user's handler recommendations for every event kind */
export function UserAppRecommendationsModel(user: string | ProfilePointer): Model<AppRecommendationEvent[]> {
  const pubkey = typeof user === "string" ? user : user.pubkey;
  return (store) =>
    store
      .timeline({ kinds: [APP_RECOMMENDATION_KIND], authors: [pubkey] })
      .pipe(map((events) => events.filter(isValidAppRecommendation)));
}

/** A model that returns the handlers recommended for an event kind, ranked by how many authors recommend each */
export function RecommendedAppHandlersModel(kind: number, authors?: string[]): Model<RankedAppHandler[]> {
  return (store) =>
    store.model(AppRecommendationsModel, kind, authors).pipe(
      switchMap((recommendations) => {
        const ranked = new Map<string, { pointer: AddressPointer; recommenders: Set<string> }>();
        for (const recommendation of recommendations) {
          // A set counts each author once, even if they list the handler for several platforms
          for (const { pointer } of getRecommendedHandlers(recommendation)) {
            const address = getReplaceableAddressFromPointer(pointer);
            const entry = ranked.get(address) ?? { pointer, recommenders: new Set<string>() };
            entry.recommenders.add(recommendation.pubkey);
            ranked.set(address, entry);
          }
        }
        if (ranked.size === 0) return of([]);

        const entries = [...ranked.values()].sort((a, b) => b.recommenders.size - a.recommenders.size);
        return combineLatest(entries.map((e) => store.replaceable(e.pointer))).pipe(
          map((events) =>
            events.flatMap((handler, i): RankedAppHandler[] =>
              isValidAppHandler(handler) ? [{ handler, recommenders: [...entries[i].recommenders] }] : [],
            ),
          ),
        );
      }),
    );
}
