import { getEventPointerForEvent } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { ensureMarkedEventPointerTag } from "../helpers/common-tags.js";
import { EventOperation } from "../types.js";

/** Includes the "e" tag referencing the channel creating event */
export function includeChannelPointerTag(channel: NostrEvent): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);
    tags = ensureMarkedEventPointerTag(tags, getEventPointerForEvent(channel), "root");
    return { ...draft, tags };
  };
}
