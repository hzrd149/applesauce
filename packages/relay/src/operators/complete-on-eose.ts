import { MonoTypeOperatorFunction, OperatorFunction, takeWhile } from "rxjs";
import { NostrEvent } from "applesauce-core/helpers/event";

import { SubscriptionResponse } from "../types.js";

export function completeOnEose(includeEose: true): MonoTypeOperatorFunction<SubscriptionResponse>;
export function completeOnEose(): OperatorFunction<SubscriptionResponse, NostrEvent>;
export function completeOnEose(includeEose: false): OperatorFunction<SubscriptionResponse, NostrEvent>;
export function completeOnEose(
  inclusive?: boolean,
): OperatorFunction<SubscriptionResponse, NostrEvent> | MonoTypeOperatorFunction<SubscriptionResponse> {
  return takeWhile((m) => m !== "EOSE", inclusive);
}
