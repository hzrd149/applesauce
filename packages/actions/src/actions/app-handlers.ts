import { AppRecommendationFactory } from "applesauce-common/factories";
import { HandlerLinkPlatform } from "applesauce-common/helpers/app-handler";
import { APP_RECOMMENDATION_KIND } from "applesauce-common/helpers/app-recommendation";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { Action, ActionContext } from "../action-runner.js";

async function getRecommendation({ user }: ActionContext, kind: number) {
  return Promise.all([
    user.replaceable(APP_RECOMMENDATION_KIND, String(kind)).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);
}

/** An action that recommends a NIP-89 handler for an event kind in the user's 31989 recommendation */
export function RecommendAppHandler(
  kind: number,
  handler: AddressPointer | string,
  platform?: HandlerLinkPlatform,
): Action {
  return async (context) => {
    const [event, outboxes] = await getRecommendation(context, kind);
    const factory = event ? AppRecommendationFactory.modify(event) : AppRecommendationFactory.create(kind);
    const signed = await factory.handler(handler, platform).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a NIP-89 handler from the user's 31989 recommendation for an event kind */
export function RemoveAppHandlerRecommendation(
  kind: number,
  handler: AddressPointer | string,
  platform?: HandlerLinkPlatform,
): Action {
  return async (context) => {
    const [event, outboxes] = await getRecommendation(context, kind);
    if (!event) return;
    const signed = await AppRecommendationFactory.modify(event).removeHandler(handler, platform).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}
