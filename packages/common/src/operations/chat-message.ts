import { EventOperation } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { ensureQuoteEventPointerTag } from "applesauce-core/helpers/factory";
import { modifyPublicTags } from "applesauce-core/operations/tags";

/**
 * Adds a NIP-C7 `q` reply tag pointing at the parent chat message. A reply to a
 * kind 9 is another kind 9 that quotes its parent with a `q` tag
 * (`["q", <id>, <relay>, <pubkey>]`).
 */
export function includeChatReply(parent: NostrEvent | EventPointer): EventOperation {
  // Normalize a full event to an EventPointer (pubkey -> author)
  const pointer: EventPointer = "pubkey" in parent ? { id: parent.id, author: parent.pubkey } : parent;
  return modifyPublicTags((tags) => ensureQuoteEventPointerTag(tags, pointer));
}
