import { EventModels, IEventSubscriptions } from "applesauce-core";
import { getParentEventStore, NostrEvent } from "applesauce-core/helpers";
import { Observable } from "rxjs";
import { chainable, ChainableObservable } from "../observable/chainable.js";

/** Internal helper for getting the parent store of an event */
export function getStore(event: NostrEvent): IEventSubscriptions & EventModels {
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
