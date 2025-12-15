import { TagOperation } from "applesauce-core/event-factory";
import { isEvent, isReplaceable, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer, isAddressPointer, isEventPointer } from "applesauce-core/helpers/pointers";
import {
  addAddressPointerTag,
  addEventPointerTag,
  removeAddressPointerTag,
  removeEventPointerTag,
} from "applesauce-core/operations/tag/common";

/** Adds an "e" or "a" tag to a bookmark list or set */
export function addEventBookmarkTag(event: NostrEvent | EventPointer | AddressPointer): TagOperation {
  // Validate event kind if event or address pointer
  if (
    (isEvent(event) || isAddressPointer(event)) &&
    event.kind !== kinds.ShortTextNote &&
    event.kind !== kinds.LongFormArticle
  )
    throw new Error(`Event kind (${event.kind}) cant not be added to bookmarks`);

  if (isEvent(event)) {
    // Add "a" tag for replaceable articles
    if (isReplaceable(event.kind)) return addAddressPointerTag(event);
    // Add "e" tag for non-replaceable notes
    else return addEventPointerTag(event);
  }
  // "e" tags for note event pointers
  else if (isEventPointer(event)) return addEventPointerTag(event);
  // "a" tags for address pointers
  else return addAddressPointerTag(event);
}

/** Removes an "e" or "a" tag from a bookmark list or set */
export function removeEventBookmarkTag(event: NostrEvent | EventPointer | AddressPointer): TagOperation {
  if (isEvent(event)) {
    // Remove "a" tag for replaceable articles
    if (isReplaceable(event.kind)) return removeAddressPointerTag(event);
    // Remove "e" tag for non-replaceable notes
    else return removeEventPointerTag(event);
  }
  // "e" tags for note event pointers
  else if (isEventPointer(event)) return removeEventPointerTag(event);
  // "a" tags for address pointers
  else return removeAddressPointerTag(event);
}
