import { TagOperation } from "applesauce-core/event-factory";
import { tagPipe } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";
import {
  addAddressPointerTag,
  addEventPointerTag,
  removeAddressPointerTag,
  removeEventPointerTag,
} from "applesauce-core/operations/tag/common";

/** Adds an "e" or "a" tag to a bookmark list or set */
export function addEventBookmarkTag(event: NostrEvent): TagOperation {
  if (event.kind !== kinds.ShortTextNote && event.kind !== kinds.LongFormArticle)
    throw new Error(`Event kind (${event.kind}) cant not be added to bookmarks`);

  const address = getAddressPointerForEvent(event);
  return address ? addAddressPointerTag(address) : addEventPointerTag(event.id);
}

/** Removes an "e" or "a" tag from a bookmark list or set */
export function removeEventBookmarkTag(event: NostrEvent): TagOperation {
  if (event.kind !== kinds.ShortTextNote && event.kind !== kinds.LongFormArticle)
    throw new Error(`Event kind (${event.kind}) cant not be added to bookmarks`);

  const address = getAddressPointerForEvent(event);

  return tagPipe(
    // Remove address pointer if it exists
    address ? removeAddressPointerTag(address) : undefined,
    // Always remove event pointer
    removeEventPointerTag(event.id),
  );
}
