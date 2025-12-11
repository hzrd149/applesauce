import { EventModels, IEventSubscriptions } from "applesauce-core";
import { getParentEventStore, KnownEvent, NostrEvent } from "applesauce-core/helpers";

/** Internal helper for getting the parent store of an event */
export function getStore(event: NostrEvent): IEventSubscriptions & EventModels {
  const store = getParentEventStore(event);
  if (!store) throw new Error("Event is not attached to an event store");
  return store as unknown as IEventSubscriptions & EventModels;
}

/** The base class for all casts */
export class BaseCast<Kind extends number = number> implements KnownEvent<Kind> {
  id!: string;
  pubkey!: string;
  kind!: Kind;
  created_at!: number;
  tags!: string[][];
  content!: string;
  sig!: string;

  constructor() {}

  /** Internal helper for getting the event store that the event is attached to */
  protected _store() {
    const store = getParentEventStore(this);
    if (!store) throw new Error("Event is not attached to an event store");
    return store;
  }
}
