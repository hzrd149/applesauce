import { filter, OperatorFunction } from "rxjs";
import { NostrEvent } from "applesauce-core/helpers/event";
import { RelaySubscriptionResponse } from "../types.js";

/** Filter subscription responses and only return the events */
export function onlyEvents(): OperatorFunction<RelaySubscriptionResponse, NostrEvent> {
  return (source) => source.pipe(filter((r) => r !== "EOSE"));
}
