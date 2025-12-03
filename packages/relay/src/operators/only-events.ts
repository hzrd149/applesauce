import { filter, OperatorFunction } from "rxjs";
import { NostrEvent } from "applesauce-core/helpers/event";
import { SubscriptionResponse } from "../types.js";

/** Filter subscription responses and only return the events */
export function onlyEvents(): OperatorFunction<SubscriptionResponse, NostrEvent> {
  return (source) => source.pipe(filter((r) => r !== "EOSE"));
}
