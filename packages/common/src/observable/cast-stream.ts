import { NostrEvent } from "applesauce-core/helpers";
import { defined } from "applesauce-core/observable";
import { map, OperatorFunction } from "rxjs";
import { EventCast, castEvent, CastConstructor } from "../casts/index.js";

/** Casts an event to a specific type */
export function castEventStream<C extends EventCast>(
  cls: CastConstructor<C>,
): OperatorFunction<NostrEvent | undefined, C> {
  return (source) =>
    source.pipe(
      map((event) => {
        if (!event) return undefined;
        try {
          return castEvent(event, cls);
        } catch (err) {
          return undefined;
        }
      }),
      defined(),
    );
}

/** Casts and array of events to an array of casted events */
export function castTimelineStream<C extends EventCast>(cls: CastConstructor<C>): OperatorFunction<NostrEvent[], C[]> {
  return (source) =>
    source.pipe(
      map((events) => {
        const castedEvents: C[] = [];
        for (const event of events) {
          try {
            const casted = castEvent(event, cls);
            castedEvents.push(casted);
          } catch {}
        }
        return castedEvents;
      }),
      defined(),
    );
}
