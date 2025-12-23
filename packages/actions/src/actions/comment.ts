import { CommentBlueprint, CommentBlueprintOptions } from "applesauce-common/blueprints";
import { castUser } from "applesauce-common/casts";
import { CommentPointer, isCommentAddressPointer, isCommentEventPointer } from "applesauce-common/helpers/comment";
import { relaySet } from "applesauce-core/helpers";
import { isEvent, NostrEvent } from "applesauce-core/helpers/event";
import { Action } from "../action-runner.js";

/**
 * Extracts the pubkey from a parent event or CommentPointer.
 * Returns undefined if the pubkey is not available.
 */
function getParentPubkey(parent: NostrEvent | CommentPointer): string | undefined {
  if (isEvent(parent)) return parent.pubkey;
  if (isCommentEventPointer(parent)) return parent.pubkey;
  if (isCommentAddressPointer(parent)) return parent.pubkey;

  // CommentExternalPointer doesn't have a pubkey
  return undefined;
}

/**
 * Creates a comment on an event or CommentPointer and publishes it to:
 * - The parent event's author's inboxes (if the author exists and pubkey is available)
 * - The current user's outboxes
 */
export function CreateComment(
  parent: NostrEvent | CommentPointer,
  content: string,
  options?: CommentBlueprintOptions,
): Action {
  return async ({ factory, user, publish, events, sign }) => {
    // Get the parent author's pubkey from the pointer/event (without loading the full event)
    const parentAuthorPubkey = getParentPubkey(parent);

    // Get the parent author's inboxes in parallel with resolving the event
    const [parentAuthorInboxes, userOutboxes] = await Promise.all([
      // Get inboxes if we have a pubkey and it's different from current user
      parentAuthorPubkey ? castUser(parentAuthorPubkey, events).inboxes$.$first(1_000, undefined) : undefined,
      // Get the current user's outboxes
      user.outboxes$.$first(1_000, undefined),
    ]);

    // Create and sign the comment
    const comment = await factory.create(CommentBlueprint, parent, content, options).then(sign);

    // Combine all relay lists (remove duplicates)
    const relays = relaySet(parentAuthorInboxes, userOutboxes);

    // Publish to all relays (inboxes and outboxes)
    await publish(comment, relays.length > 0 ? relays : undefined);
  };
}
