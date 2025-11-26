import { getAddressPointerForEvent, isReplaceable } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "nostr-tools";
import { TagOperation } from "applesauce-core/factory-types.js";
import { addCoordinateTag, addEventTag, removeCoordinateTag, removeEventTag } from "applesauce-core/factory-operations/tag/common.js";

/** Adds an "e" or "a" tag to a bookmark list or set */
export function addEventBookmarkTag(event: NostrEvent): TagOperation {
  if (event.kind !== kinds.ShortTextNote && event.kind !== kinds.LongFormArticle)
    throw new Error(`Event kind (${event.kind}) cant not be added to bookmarks`);

  return isReplaceable(event.kind) ? addCoordinateTag(getAddressPointerForEvent(event)) : addEventTag(event.id);
}

/** Removes an "e" or "a" tag from a bookmark list or set */
export function removeEventBookmarkTag(event: NostrEvent): TagOperation {
  if (event.kind !== kinds.ShortTextNote && event.kind !== kinds.LongFormArticle)
    throw new Error(`Event kind (${event.kind}) cant not be added to bookmarks`);

  return isReplaceable(event.kind) ? removeCoordinateTag(getAddressPointerForEvent(event)) : removeEventTag(event.id);
}


