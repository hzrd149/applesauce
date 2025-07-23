import { AddressPointer } from "nostr-tools/nip19";
import { EventOperation } from "../../types.js";
import { addAddressTag, removeAddressTag } from "../tag/common.js";
import { includeSingletonTag, modifyPublicTags } from "./tags.js";
import { NostrEvent } from "nostr-tools";
import { getAddressPointerForEvent, isAddressPointer } from "applesauce-core/helpers";

/** Sets the title of a calendar */
export function calendarSetTitle(title: string): EventOperation {
  return includeSingletonTag(["title", title], true);
}

/** Adds a calendar event tags to a calendar event */
export function calendarAddEvent(event: AddressPointer | NostrEvent): EventOperation {
  return modifyPublicTags(addAddressTag(isAddressPointer(event) ? event : getAddressPointerForEvent(event)));
}

/** Removes a calendar event tags from a calendar event */
export function calendarRemoveEvent(event: AddressPointer | NostrEvent): EventOperation {
  return modifyPublicTags(removeAddressTag(isAddressPointer(event) ? event : getAddressPointerForEvent(event)));
}
