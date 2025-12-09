import { EventOperation } from "../event-factory/types.js";
import { NostrEvent, isAddressableKind, isReplaceableKind } from "../helpers/event.js";
import { ensureAddressPointerTag, ensureEventPointerTag, ensureKTag } from "../helpers/factory.js";
import { getAddressPointerForEvent } from "../helpers/pointers.js";

/** Sets the necessary tags for a NIP-09 delete event to point to a the events being deleted */
export function setDeleteEvents(events: NostrEvent[]): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    for (const event of events) {
      tags = ensureKTag(tags, event.kind);
      tags = ensureEventPointerTag(tags, event);

      if (isAddressableKind(event.kind) || isReplaceableKind(event.kind)) {
        const pointer = getAddressPointerForEvent(event);
        if (pointer) tags = ensureAddressPointerTag(tags, pointer);
      }
    }

    return { ...draft, tags };
  };
}
