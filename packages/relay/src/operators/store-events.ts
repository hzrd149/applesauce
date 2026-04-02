import { IEventStore } from "applesauce-core";
import { MonoTypeOperatorFunction, tap } from "rxjs";
import { RelaySubscriptionResponse } from "../types.js";

/** Sends all events to the event store but does not remove duplicates */
export function storeEvents(eventStore: IEventStore): MonoTypeOperatorFunction<RelaySubscriptionResponse> {
  return (source) => {
    return source.pipe(tap((event) => typeof event !== "string" && eventStore.add(event)));
  };
}
