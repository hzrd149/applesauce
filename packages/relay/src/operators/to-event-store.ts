import { OperatorFunction } from "rxjs";
import { IEventStore } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { mapEventsToStore, mapEventsToTimeline } from "applesauce-core/observable";

import { SubscriptionResponse } from "../types.js";
import { completeOnEose } from "./complete-on-eose.js";

/**
 * Adds all events to event store and returns a deduplicated timeline when EOSE is received
 * @deprecated use `mapEventsToStore` and `mapEventsToTimeline` instead
 */
export function toEventStore(eventStore: IEventStore): OperatorFunction<SubscriptionResponse, NostrEvent[]> {
  return (source) =>
    source.pipe(
      // Complete when there are not events
      completeOnEose(),
      // Save events to store and remove duplicates
      mapEventsToStore(eventStore, true),
      // Add the events to an array
      mapEventsToTimeline(),
    );
}
