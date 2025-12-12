import { NostrEvent } from "applesauce-core/helpers";
import { defined } from "applesauce-core/observable";
import { map, OperatorFunction } from "rxjs";
import { Cast, cast, CastConstructor } from "../casts/index.js";

/** Casts an event to a specific type */
export function castEvent<C extends Cast>(cls: CastConstructor<C>): OperatorFunction<NostrEvent | undefined, C> {
  return (source) =>
    source.pipe(
      map((event) => {
        if (!event) return undefined;
        try {
          return cast(event, cls);
        } catch (err) {
          return undefined;
        }
      }),
      defined(),
    );
}

/** Casts and array of events to an array of casted events */
export function castEvents<C extends Cast>(cls: CastConstructor<C>): OperatorFunction<NostrEvent[], C[]> {
  return (source) =>
    source.pipe(
      map((events) => {
        const castedEvents: C[] = [];
        for (const event of events) {
          try {
            const casted = cast(event, cls);
            castedEvents.push(casted);
          } catch {}
        }
        return castedEvents;
      }),
      defined(),
    );
}
