import { map, OperatorFunction } from "rxjs";
import type { CastConstructor, CastRefEventStore } from "../casts/cast.js";
import { castEvent, EventCast } from "../casts/index.js";
import { StoreEvent } from "../helpers/event.js";
import { defined } from "./defined.js";

/** Casts an event to a specific type */
export function castEventStream<C extends EventCast<StoreEvent>>(
  cls: CastConstructor<C>,
  store?: CastRefEventStore,
): OperatorFunction<StoreEvent | undefined, C | undefined> {
  return (source) =>
    source.pipe(
      map((event) => {
        if (!event) return undefined;
        try {
          return castEvent(event, cls, store);
        } catch {}
        return undefined;
      }),
    );
}

/** Casts and array of events to an array of casted events and filters out undefined values */
export function castTimelineStream<C extends EventCast<StoreEvent>>(
  cls: CastConstructor<C>,
  store?: CastRefEventStore,
): OperatorFunction<StoreEvent[], C[]> {
  return (source) =>
    source.pipe(
      map((events) => {
        const castedEvents: C[] = [];
        for (const event of events) {
          try {
            const casted = castEvent(event, cls, store);
            castedEvents.push(casted);
          } catch {}
        }
        return castedEvents;
      }),
      defined(),
    );
}
