import { NostrEvent } from "applesauce-core/helpers/event";
import { insertEventIntoDescendingList } from "nostr-tools/utils";
import { OperatorFunction, pipe, scan } from "rxjs";
import { withImmediateValueOrDefault } from "./with-immediate-value.js";

/**
 * Accumulate events into an ordered timeline
 * @note This does not remove duplicate events
 */
export function mapEventsToTimeline(): OperatorFunction<NostrEvent, NostrEvent[]> {
  return pipe(
    scan((timeline, event) => insertEventIntoDescendingList(timeline, event), [] as NostrEvent[]),
    // Emit an empty array first. This is to prevent empty observables completing without a value (EMPTY)
    withImmediateValueOrDefault([] as NostrEvent[]),
  );
}
