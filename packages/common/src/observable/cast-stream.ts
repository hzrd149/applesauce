import type { NostrEvent } from "applesauce-core/helpers/event";
import { defined } from "applesauce-core/observable/defined";
import { map, OperatorFunction } from "rxjs";
import type { CastConstructor } from "../casts/cast.js";
import { castEvent, EventCast } from "../casts/cast.js";

/** Casts an event to a specific type */
export function castEventStream<C extends EventCast>(
  cls: CastConstructor<C>,
): OperatorFunction<NostrEvent | undefined, C | undefined> {
  return (source) =>
    source.pipe(
      map((event) => {
        if (!event) return undefined;
        try {
          return castEvent(event, cls);
        } catch {}
        return undefined;
      }),
    );
}

/** Casts and array of events to an array of casted events and filters out undefined values */
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
