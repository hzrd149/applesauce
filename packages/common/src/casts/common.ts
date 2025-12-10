import { EventModels, IEventSubscriptions } from "applesauce-core";
import { getParentEventStore, NostrEvent } from "applesauce-core/helpers";

/** Internal helper for getting the parent store of an event */
export function getStore(event: NostrEvent): IEventSubscriptions & EventModels {
  const store = getParentEventStore(event);
  if (!store) throw new Error("Event is not attached to an event store");
  return store as unknown as IEventSubscriptions & EventModels;
}
