import { Model } from "applesauce-core/event-store";
import { AddressPointer, getReplaceableAddressFromPointer } from "applesauce-core/helpers/pointers";
import { combineLatest, map, of, switchMap } from "rxjs";
import { APP_HANDLER_KIND, AppHandlerEvent, isValidAppHandler } from "../helpers/app-handler.js";
import {
  APP_RECOMMENDATION_KIND,
  AppRecommendationEvent,
  getRecommendedHandlers,
  isValidAppRecommendation,
} from "../helpers/app-recommendation.js";

/** A model that returns NIP-89 handlers that advertise support for an event kind */
export function AppHandlersModel(kind: number): Model<AppHandlerEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [APP_HANDLER_KIND], "#k": [String(kind)] })
      .pipe(map((events) => events.filter(isValidAppHandler)));
}

/** A model that returns NIP-89 handler recommendations for an event kind, optionally from a set of authors */
export function AppRecommendationsModel(kind: number, authors?: string[]): Model<AppRecommendationEvent[]> {
  return (store) =>
    store
      .timeline({ kinds: [APP_RECOMMENDATION_KIND], "#d": [String(kind)], ...(authors ? { authors } : {}) })
      .pipe(map((events) => events.filter(isValidAppRecommendation)));
}

/** A model that returns the handlers recommended for an event kind, ranked by how many authors recommend each */
export function RecommendedAppHandlersModel(kind: number, authors?: string[]): Model<AppHandlerEvent[]> {
  return (store) =>
    store.model(AppRecommendationsModel, kind, authors).pipe(
      switchMap((recommendations) => {
        const ranked = new Map<string, { pointer: AddressPointer; count: number }>();
        for (const recommendation of recommendations) {
          // Count each handler once per recommendation, even if it is listed for several platforms
          const seen = new Set<string>();
          for (const { pointer } of getRecommendedHandlers(recommendation)) {
            const address = getReplaceableAddressFromPointer(pointer);
            if (seen.has(address)) continue;
            seen.add(address);
            const entry = ranked.get(address);
            if (entry) entry.count++;
            else ranked.set(address, { pointer, count: 1 });
          }
        }
        if (ranked.size === 0) return of([]);

        const pointers = [...ranked.values()].sort((a, b) => b.count - a.count).map((h) => h.pointer);
        return combineLatest(pointers.map((p) => store.replaceable(p))).pipe(
          map((events) => events.filter(isValidAppHandler)),
        );
      }),
    );
}
