import { EventOperation } from "applesauce-core/factories";
import { NostrEvent, Rumor } from "applesauce-core/helpers/event";
import {
  COMMENT_KIND,
  CommentPointer,
  createCommentTagsForEvent,
  createCommentTagsFromCommentPointer,
} from "../helpers/comment.js";

/**
 * The event a comment points to. A full event/rumor carries its tags (so a reply
 * to another comment can inherit that comment's root pointer), or a
 * {@link CommentPointer} for cases where only the identity is known.
 */
export type CommentParent = NostrEvent | Rumor | CommentPointer;

/**
 * Sets the necessary tags for a NIP-22 comment event to point to a parent event or pointer
 * @param parent - Parent event, rumor, or comment pointer
 * @param getRelayHint - Optional function to get relay hint for event ID
 */
export function setParent(
  parent: CommentParent,
  getRelayHint?: (eventId: string) => Promise<string | undefined>,
): EventOperation {
  return async (draft) => {
    let tags = Array.from(draft.tags);

    // Only a full event or rumor carries tags; a pointer is just an identity.
    // Discriminate on that rather than on the signature — an unsigned rumor
    // (e.g. a NIP-59 seal's inner event) has everything needed to build tags.
    if ("tags" in parent) {
      const relayHint = getRelayHint ? await getRelayHint(parent.id) : undefined;
      tags.push(...createCommentTagsForEvent(parent, relayHint));
    } else {
      // A pointer to a comment carries no root tags, and NIP-22 requires nested
      // replies to stay rooted on the original event — so the full comment
      // event is the only thing correct root tags can be built from.
      if (parent.kind === COMMENT_KIND)
        throw new Error("Comment pointer cannot be a comment kind. please pass the full nip-22 comment event");

      // For CommentPointer, treat as root comment: both root and reply tags point to the same pointer
      // Note: relay hints are already included in the pointer if available

      // Add root tags (capitalized)
      tags.push(...createCommentTagsFromCommentPointer(parent, true));
      // Add reply tags (lowercase)
      tags.push(...createCommentTagsFromCommentPointer(parent, false));
    }

    return { ...draft, tags };
  };
}
