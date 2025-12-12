import { NostrEvent } from "./event.js";
import { AddressPointer, EventPointer, getAddressPointerFromATag, getEventPointerFromETag } from "./pointers.js";
import { isATag, isETag } from "./tags.js";

/** Get all deleted event ids from a delete event */
export function getDeleteIds(deleteEvent: NostrEvent): string[] {
  return deleteEvent.tags.filter(isETag).map((t) => t[1]);
}

/** Get all deleted coordinates from a delete event */
export function getDeleteAddressStrings(deleteEvent: NostrEvent): string[] {
  return deleteEvent.tags.filter(isATag).map((t) => t[1]);
}

/** Get all deleted event pointers from a delete event */
export function getDeleteEventPointers(deleteEvent: NostrEvent): EventPointer[] {
  return deleteEvent.tags
    .filter(isETag)
    .map(getEventPointerFromETag)
    .filter((p) => p !== null)
    .map((pointer) => {
      // Explicitly set the author to the delete event author (prevents bob from deleting alice's events)
      pointer.author = deleteEvent.pubkey;
      return pointer;
    });
}

/** Get all deleted address pointers from a delete event */
export function getDeleteAddressPointers(deleteEvent: NostrEvent): AddressPointer[] {
  return (
    deleteEvent.tags
      .filter(isATag)
      .map(getAddressPointerFromATag)
      .filter((p) => p !== null)
      // Only return address pointers that have the same pubkey as the delete event author
      .filter((p) => p.pubkey === deleteEvent.pubkey)
  );
}
