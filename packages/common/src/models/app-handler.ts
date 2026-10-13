import { Model } from "applesauce-core/event-store";
import { map } from "rxjs";
import { APP_HANDLER_KIND, AppHandlerEvent, isValidAppHandler } from "../helpers/app-handler.js";
import {
  APP_RECOMMENDATION_KIND,
  AppRecommendationEvent,
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
