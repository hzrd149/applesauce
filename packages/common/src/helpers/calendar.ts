import { getTagValue, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { isATag } from "applesauce-core/helpers/tags";

/** Gets the title of a calendar */
export function getCalendarTitle(event: NostrEvent) {
  return getTagValue(event, "title");
}

/** Gets the address pointers to all the events on the calendar */
export function getCalendarAddressPointers(event: NostrEvent): AddressPointer[] {
  return event.tags
    .filter(isATag)
    .map(getAddressPointerFromATag)
    .filter((p) => p !== null);
}
