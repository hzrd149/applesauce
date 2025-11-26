import { EventOperation } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, getAddressPointerForEvent, isAddressPointer } from "applesauce-core/helpers/pointers";
import { addAddressTag, removeAddressTag } from "applesauce-core/operations/tag/common";
import { includeSingletonTag, modifyPublicTags } from "applesauce-core/operations/tags";

/** Sets the title of a calendar */
export function setTitle(title: string): EventOperation {
  return includeSingletonTag(["title", title], true);
}

/** Adds a calendar event tags to a calendar event */
export function addEvent(event: AddressPointer | NostrEvent): EventOperation {
  return modifyPublicTags(addAddressTag(isAddressPointer(event) ? event : getAddressPointerForEvent(event)));
}

/** Removes a calendar event tags from a calendar event */
export function removeEvent(event: AddressPointer | NostrEvent): EventOperation {
  return modifyPublicTags(removeAddressTag(isAddressPointer(event) ? event : getAddressPointerForEvent(event)));
}
