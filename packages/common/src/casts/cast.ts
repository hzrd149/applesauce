import { NostrEvent } from "applesauce-core/helpers/event";

/** A symbol used to store all the casts for an event */
export const CASTS_SYMBOL = Symbol.for("casts");

/** A class that can be used to cast a Nostr event */
export type CastClass<T extends NostrEvent> = new (event: NostrEvent) => T;

/** Cast a Nostr event to a specific class */
export function cast<T extends NostrEvent>(event: NostrEvent, cls: CastClass<T>): T {
  const casts: Map<CastClass<T>, T> = Reflect.get(event, CASTS_SYMBOL);

  // If the event has already been cast to this class, return the existing cast
  const existing = casts?.get(cls);
  if (existing) return existing;

  // Create a new instance of the class
  const cast = new cls(event);
  if (!casts) Reflect.set(event, CASTS_SYMBOL, new Map([[cls, cast]]));
  else casts.set(cls, cast);

  return cast;
}
