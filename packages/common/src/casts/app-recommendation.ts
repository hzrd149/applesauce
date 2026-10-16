import "./user.js";
import { ChainableObservable } from "applesauce-core";
import { User } from "applesauce-core/casts/user";
import { NostrEvent } from "applesauce-core/helpers/event";
import { combineLatest, of } from "rxjs";
import {
  AppRecommendationEvent,
  getRecommendationKind,
  getRecommendedHandlers,
  isValidAppRecommendation,
} from "../helpers/app-recommendation.js";
import { UserAppRecommendationsModel } from "../models/app-handler.js";
import { castEventStream, castTimelineStream } from "../observable/cast-stream.js";
import { AppHandler } from "./app-handler.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast for NIP-89 handler recommendation events (kind 31989) */
export class AppRecommendation extends EventCast<AppRecommendationEvent> {
  /**
   * Creates a cast for a validated recommendation
   * @throws if the event is not a valid handler recommendation
   */
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidAppRecommendation(event)) throw new Error("Invalid app recommendation");
    super(event, store);
  }

  /** The event kind the recommendation applies to */
  get supportedKind() {
    return getRecommendationKind(this.event);
  }
  /** The recommended handler pointers and their platforms */
  get handlers() {
    return getRecommendedHandlers(this.event);
  }

  /** Subscribes to the recommended handlers, in the same order as {@link handlers} */
  get handlers$(): ChainableObservable<(AppHandler | undefined)[]> {
    return this.$$ref("handlers$", (store) =>
      this.handlers.length
        ? combineLatest(this.handlers.map((h) => store.replaceable(h.pointer).pipe(castEventStream(AppHandler, store))))
        : of([]),
    );
  }
}

Object.defineProperty(User.prototype, "appRecommendations$", {
  get(this: User) {
    return this.$$ref("appRecommendations$", (store) =>
      store.model(UserAppRecommendationsModel, this.pubkey).pipe(castTimelineStream(AppRecommendation, store)),
    );
  },
  configurable: true,
  enumerable: false,
});

declare module "applesauce-core/casts" {
  interface User {
    /** Subscribes to the user's app handler recommendations for every event kind */
    get appRecommendations$(): ChainableObservable<AppRecommendation[]>;
  }
}
