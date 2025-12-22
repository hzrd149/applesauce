import { EventOperation } from "applesauce-core/event-factory";
import { isEvent, NostrEvent } from "applesauce-core/helpers/event";
import {
  COMMENT_KIND,
  CommentPointer,
  createCommentTagsForEvent,
  createCommentTagsFromCommentPointer,
} from "../helpers/comment.js";

/** Sets the necessary tags for a NIP-22 comment event to point to a parent event or pointer */
export function setParent(parent: NostrEvent | CommentPointer): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);

    // If parent is a CommentPointer (not a NostrEvent), handle it directly
    if (!isEvent(parent)) {
      if (parent.kind === COMMENT_KIND)
        throw new Error("Comment pointer cannot be a comment kind. please pass the full nip-22 comment event");

      // For CommentPointer, treat as root comment: both root and reply tags point to the same pointer
      // Note: relay hints are already included in the pointer if available

      // Add root tags (capitalized)
      tags.push(...createCommentTagsFromCommentPointer(parent, true));
      // Add reply tags (lowercase)
      tags.push(...createCommentTagsFromCommentPointer(parent, false));
    } else {
      // If parent is a NostrEvent, use existing logic
      const relayHint = await ctx.getEventRelayHint?.(parent.id);
      tags.push(...createCommentTagsForEvent(parent, relayHint));
    }

    return { ...draft, tags };
  };
}
