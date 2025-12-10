import { NostrEvent } from "applesauce-core/helpers/event";

/** A type used to cast a nostr event to a specific prototype */
export type Cast<Event extends NostrEvent = NostrEvent, Proto extends object = object> = (
  event: NostrEvent,
) => Event & Proto;

/** Creates a new cast function for a specific event kind */
export function createCast<Event extends NostrEvent = NostrEvent, Proto extends object = object>(
  verify: (event: NostrEvent) => event is Event,
  prototype: Proto & ThisType<Proto & Event>,
): Cast<Event, Proto> {
  return (event) => {
    // If the event is already cast, return it
    if (Object.getPrototypeOf(event) === prototype) return event as Event & Proto;
    // If the event has been cast already, throw an error
    if (Object.getPrototypeOf(event) !== Object.prototype) throw new Error("Event already cast");
    // If the event is not valid, throw an error
    if (!verify(event)) throw new Error("Invalid event");
    // Set the prototype of the event to the prototype
    Object.setPrototypeOf(event, prototype);
    // Return the event as the casted event
    return event as Event & Proto;
  };
}

/** Helper type for inferring the type of a cast function */
export type InferCast<C extends Cast> = ReturnType<C>;
