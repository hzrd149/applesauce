import { OperatorFunction, pipe, scan } from "rxjs";
import { insertEventIntoDescendingList, NostrEvent } from "../helpers/event.js";
import { withImmediateValueOrDefault } from "./with-immediate-value.js";

/**
 * Accumulate events into an ordered timeline
 * @note If a string is passed in, it will be ignored and the timeline will not be modified
 * @note This does not remove duplicate events
 */
export function mapEventsToTimeline<T extends NostrEvent | string>(): OperatorFunction<T, NostrEvent[]> {
  return pipe(
    scan((timeline, event) => {
      if (typeof event === "string") return timeline;
      else return insertEventIntoDescendingList(timeline, event);
    }, [] as NostrEvent[]),
    // Emit an empty array first. This is to prevent empty observables completing without a value (EMPTY)
    withImmediateValueOrDefault([] as NostrEvent[]),
  );
}
