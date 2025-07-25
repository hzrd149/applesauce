import { NostrEvent } from "nostr-tools";
import { isAddressableKind } from "nostr-tools/kinds";
import { getAddressPointerForEvent } from "applesauce-core/helpers";

import { EventOperation } from "../types.js";
import { ensureAddressPointerTag, ensureEventPointerTag, ensureKTag } from "../helpers/common-tags.js";

/** Sets the necessary tags for a NIP-09 delete event to point to a the events being deleted */
export function setDeleteEvents(events: NostrEvent[]): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    for (const event of events) {
      tags = ensureKTag(tags, event.kind);
      tags = ensureEventPointerTag(tags, event);

      if (isAddressableKind(event.kind)) {
        tags = ensureAddressPointerTag(tags, getAddressPointerForEvent(event));
      }
    }

    return { ...draft, tags };
  };
}
