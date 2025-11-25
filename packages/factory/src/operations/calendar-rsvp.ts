import {
  DATE_BASED_CALENDAR_EVENT_KIND,
  TIME_BASED_CALENDAR_EVENT_KIND,
} from "applesauce-common/helpers/calendar-event";
import { RSVPFreeBusy, RSVPStatus } from "applesauce-common/helpers/calendar-rsvp";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  addRelayHintsToPointer,
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  isAddressPointer,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";

import {
  createATagFromAddressPointer,
  createETagFromEventPointer,
  createPTagFromProfilePointer,
} from "../helpers/pointer.js";
import { EventOperation } from "../types.js";
import { setSingletonTag } from "./tag/common.js";
import { includeSingletonTag, modifyPublicTags } from "./tags.js";

/** Sets the RSVP status for a calendar event */
export function setStatus(status: RSVPStatus): EventOperation {
  return includeSingletonTag(["status", status], true);
}

/** Sets the free busy status for a calendar event */
export function setFreeBusy(freeBusy: RSVPFreeBusy): EventOperation {
  return includeSingletonTag(["fb", freeBusy], true);
}

/** Sets the pointers to the calendar event for an RSVP event */
export function setCalendarEvent(pointer: NostrEvent | AddressPointer, relay?: string): EventOperation {
  if (pointer.kind !== DATE_BASED_CALENDAR_EVENT_KIND && pointer.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("RSVP pointer must be to a calendar event");

  let addressPointer = isAddressPointer(pointer) ? pointer : getAddressPointerForEvent(pointer);
  let eventPointer: EventPointer | undefined = isAddressPointer(pointer)
    ? undefined
    : { id: pointer.id, kind: pointer.kind, author: pointer.pubkey };
  let profilePointer: ProfilePointer = { pubkey: pointer.pubkey };

  // Add relay hint if provided
  if (relay) {
    addressPointer = addRelayHintsToPointer(addressPointer, [relay]);
    if (eventPointer) eventPointer = addRelayHintsToPointer(eventPointer, [relay]);
    profilePointer = addRelayHintsToPointer(profilePointer, [relay]);
  }

  return modifyPublicTags(
    // Include "a" and "e" tags for calendar event
    setSingletonTag(createATagFromAddressPointer(addressPointer)),
    eventPointer ? setSingletonTag(createETagFromEventPointer(eventPointer)) : undefined,
    // Add a "p" tag for the event author
    setSingletonTag(createPTagFromProfilePointer(profilePointer), true),
  );
}
