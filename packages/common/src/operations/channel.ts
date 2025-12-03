import { EventOperation } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { ensureMarkedEventPointerTag } from "applesauce-core/helpers/factory";
import { getEventPointerForEvent } from "applesauce-core/helpers/pointers";

/** Includes the "e" tag referencing the channel creating event */
export function includeChannelPointerTag(channel: NostrEvent): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);
    tags = ensureMarkedEventPointerTag(tags, getEventPointerForEvent(channel), "root");
    return { ...draft, tags };
  };
}
