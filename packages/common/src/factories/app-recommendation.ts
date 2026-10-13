import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { HandlerLinkPlatform } from "../helpers/app-handler.js";
import { APP_RECOMMENDATION_KIND, isValidAppRecommendation } from "../helpers/app-recommendation.js";
import { addRecommendedHandler, removeRecommendedHandler } from "../operations/app-recommendation.js";

/** An event template for a NIP-89 handler recommendation */
export type AppRecommendationTemplate = KnownEventTemplate<typeof APP_RECOMMENDATION_KIND>;

/** Factory for NIP-89 handler recommendations (kind 31989) */
export class AppRecommendationFactory extends EventFactory<typeof APP_RECOMMENDATION_KIND, AppRecommendationTemplate> {
  /** Creates a recommendation for handlers of an event kind */
  static create(kind: number): AppRecommendationFactory {
    return new AppRecommendationFactory((res) => res(blankEventTemplate(APP_RECOMMENDATION_KIND))).chain(
      includeSingletonTag(["d", String(kind)]),
    );
  }

  /**
   * Creates a factory configured to modify an existing recommendation
   * @throws if the event is not a valid handler recommendation
   */
  static modify(event: NostrEvent): AppRecommendationFactory {
    if (!isValidAppRecommendation(event)) throw new Error("Expected a NIP-89 handler recommendation event");
    return new AppRecommendationFactory((res) => res(toEventTemplate(event)));
  }

  /** Adds or replaces a recommended handler for a platform */
  handler(handler: AddressPointer | string, platform?: HandlerLinkPlatform) {
    return this.chain(addRecommendedHandler(handler, platform));
  }
  /** Removes a recommended handler, optionally only for one platform */
  removeHandler(handler: AddressPointer | string, platform?: HandlerLinkPlatform) {
    return this.chain(removeRecommendedHandler(handler, platform));
  }
}
