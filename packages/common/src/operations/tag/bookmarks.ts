import { TagOperation } from "applesauce-core/event-factory";
import { isReplaceable } from "applesauce-core/helpers";
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

  return isReplaceable(event.kind)
    ? addAddressPointerTag(getAddressPointerForEvent(event))
    : addEventPointerTag(event.id);
}

/** Removes an "e" or "a" tag from a bookmark list or set */
export function removeEventBookmarkTag(event: NostrEvent): TagOperation {
  if (event.kind !== kinds.ShortTextNote && event.kind !== kinds.LongFormArticle)
    throw new Error(`Event kind (${event.kind}) cant not be added to bookmarks`);

  return isReplaceable(event.kind)
    ? removeAddressPointerTag(getAddressPointerForEvent(event))
    : removeEventPointerTag(event.id);
}
