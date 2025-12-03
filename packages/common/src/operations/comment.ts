import { EventOperation } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { createCommentTagsForEvent } from "../helpers/comment.js";

/** Sets the necessary tags for a NIP-22 comment event to point to a parent event */
export function setParent(parent: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    const relayHint = await ctx.getEventRelayHint?.(parent.id);
    let tags = Array.from(draft.tags);

    // add NIP-22 comment tags
    tags.push(...createCommentTagsForEvent(parent, relayHint));

    return { ...draft, tags };
  };
}
