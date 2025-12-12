import { EventModels, IEventSubscriptions } from "applesauce-core/event-store";
import { getParentEventStore, KnownEvent, NostrEvent } from "applesauce-core/helpers";
import { Observable } from "rxjs";
import { chainable, ChainableObservable } from "../observable/chainable.js";

/** Internal helper for getting the parent store of an event */
export function getStore(event: NostrEvent): IEventSubscriptions & EventModels {
  // If this is a cast, get the event from the cast
  if ("event" in event) event = event.event as typeof event;

  // Get the event store for the event
  const store = getParentEventStore(event);
  if (!store) throw new Error("Event is not attached to an event store");
  return store as unknown as IEventSubscriptions & EventModels;
}

export const CAST_REF_SYMBOL = Symbol.for("cast-ref");

/** Helper to build a ref to another cast */
export function ref<T extends unknown>(
  cast: NostrEvent,
  key: string,
  builder: (store: IEventSubscriptions & EventModels) => Observable<T>,
): ChainableObservable<T> {
  const cache: Record<string, ChainableObservable<T>> = (cast as any)[CAST_REF_SYMBOL] ||
  ((cast as any)[CAST_REF_SYMBOL] = {});

  // Return cached observable
  if (cache[key]) return cache[key];

  // Build a new observable and cache it
  const store = getStore(cast);
  const observable = chainable(builder(store));
  cache[key] = observable;
  return observable;
}

/** The base class for all casts */
export class BaseCast<Kind extends number = number> implements KnownEvent<Kind> {
  get id() {
    return this.event.id;
  }
  get pubkey() {
    return this.event.pubkey;
  }
  get kind() {
    return this.event.kind;
  }
  get created_at() {
    return this.event.created_at;
  }
  get tags() {
    return this.event.tags;
  }
  get content() {
    return this.event.content;
  }
  get sig() {
    return this.event.sig;
  }

  // Enfore kind check in constructor. this will force child classes to verify the event before calling super()
  constructor(protected readonly event: KnownEvent<Kind>) {}
}
