import { NostrEvent } from "applesauce-core/helpers";
import { map, OperatorFunction } from "rxjs";
import { Cast, InferCast } from "../casts/index.js";
import { defined } from "applesauce-core";

/** Casts an event to a specific type */
export function castEvent<Event extends NostrEvent, Proto extends object>(
  cast: Cast<Event, Proto>,
): OperatorFunction<NostrEvent | undefined, InferCast<typeof cast>> {
  return (source) =>
    source.pipe(
      map((event) => {
        if (!event) return undefined;
        try {
          return cast(event);
        } catch (err) {
          return undefined;
        }
      }),
      defined(),
    );
}

/** Casts and array of events to an array of casted events */
export function castEvents<Events extends NostrEvent, Proto extends object>(
  cast: Cast<Events, Proto>,
): OperatorFunction<NostrEvent[], InferCast<Cast<Events, Proto>>[]> {
  return (source) =>
    source.pipe(
      map((events) => {
        const castedEvents: InferCast<Cast<Events, Proto>>[] = [];
        for (const event of events) {
          try {
            const casted = cast(event);
            castedEvents.push(casted);
          } catch {}
        }
        return castedEvents;
      }),
      defined(),
    );
}
