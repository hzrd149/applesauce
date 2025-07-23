import { NostrEvent } from "nostr-tools";
import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";

import { getTagValue } from "./event-tags.js";
import { getAddressPointerFromATag, getEventPointerFromETag, getProfilePointerFromPTag } from "./pointers.js";
import { isATag, isETag, isPTag } from "./tags.js";

export const CALENDAR_EVENT_RSVP_KIND = 31925;

// RSVP Status
export type RSVPStatus = "accepted" | "declined" | "tentative";
export type RSVPFreeBusy = "free" | "busy";

/** Gets the RSVP status from a calendar event RSVP */
export function getRSVPStatus(event: NostrEvent): RSVPStatus | undefined {
  const status = getTagValue(event, "status") as RSVPStatus;
  return status && ["accepted", "declined", "tentative"].includes(status) ? status : undefined;
}

/** Gets the free/busy status from a calendar event RSVP (will be undefined if the RSVP is declined) */
export function getRSVPFreeBusy(event: NostrEvent): RSVPFreeBusy | undefined {
  const status = getRSVPStatus(event);
  if (status === "declined") return undefined;

  const fb = getTagValue(event, "fb") as RSVPFreeBusy;
  return fb && ["free", "busy"].includes(fb) ? fb : undefined;
}

/** Gets the referenced calendar event coordinate that the RSVP is responding to */
export function getRSVPAddressPointer(event: NostrEvent): AddressPointer | undefined {
  const tag = event.tags.find(isATag);
  if (!tag) return undefined;
  return getAddressPointerFromATag(tag);
}

/** Gets the referenced calendar event pointer that the RSVP is responding to */
export function getRSVPEventPointer(event: NostrEvent): EventPointer | undefined {
  const tag = event.tags.find(isETag);
  if (!tag) return undefined;
  return getEventPointerFromETag(tag);
}

/** Gets the profile pointer that the RSVP is responding to */
export function getRSVPProfilePointer(event: NostrEvent): ProfilePointer | undefined {
  const tag = event.tags.find(isPTag);
  if (!tag) return undefined;
  return getProfilePointerFromPTag(tag);
}
