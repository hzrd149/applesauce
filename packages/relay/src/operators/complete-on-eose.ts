import { MonoTypeOperatorFunction, OperatorFunction, takeWhile } from "rxjs";
import { NostrEvent } from "applesauce-core/helpers/event";

import { RelaySubscriptionResponse } from "../types.js";

export function completeOnEose(includeEose: true): MonoTypeOperatorFunction<RelaySubscriptionResponse>;
export function completeOnEose(): OperatorFunction<RelaySubscriptionResponse, NostrEvent>;
export function completeOnEose(includeEose: false): OperatorFunction<RelaySubscriptionResponse, NostrEvent>;
export function completeOnEose(
  inclusive?: boolean,
): OperatorFunction<RelaySubscriptionResponse, NostrEvent> | MonoTypeOperatorFunction<RelaySubscriptionResponse> {
  return takeWhile((m) => m !== "EOSE", inclusive);
}
