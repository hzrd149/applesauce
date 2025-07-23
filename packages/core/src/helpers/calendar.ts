import { NostrEvent } from "nostr-tools";
import { AddressPointer } from "nostr-tools/nip19";

import { getTagValue } from "./event-tags.js";
import { getAddressPointerFromATag } from "./pointers.js";
import { isATag } from "./tags.js";

/** Gets the title of a calendar */
export function getCalendarTitle(event: NostrEvent) {
  return getTagValue(event, "title");
}

/** Gets the address pointers to all the events on the calendar */
export function getCalendarAddressPointers(event: NostrEvent): AddressPointer[] {
  return event.tags.filter(isATag).map(getAddressPointerFromATag);
}
