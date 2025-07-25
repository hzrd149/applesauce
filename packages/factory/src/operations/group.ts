import { GroupPointer } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

import { EventOperation } from "../types.js";
import { ensureNamedValueTag } from "../helpers/tag.js";
import { createGroupHTagFromGroupPointer } from "../helpers/groups.js";
import { includeSingletonTag } from "./tags.js";

/** Sets the "h" tag for NIP-29 group messages or other events */
export function setGroupPointer(group: GroupPointer): EventOperation {
  return includeSingletonTag(createGroupHTagFromGroupPointer(group), true);
}

/** Adds "previous" tags for group messages */
export function addPreviousRefs(previous: NostrEvent[], count = 6): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    // sort previous events by date and limit to 50
    const sorted = previous.sort((a, b) => b.created_at - a.created_at).slice(0, 50);

    for (let i = 0; i < count; i++) {
      const index = Math.round(Math.random() * (sorted.length - 1));
      const event = sorted.splice(index, 1)[0];

      if (event) tags = ensureNamedValueTag(tags, ["previous", event.id.slice(0, 8)]);
    }

    return { ...draft, tags };
  };
}
