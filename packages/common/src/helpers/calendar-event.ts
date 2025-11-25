import { NostrEvent } from "applesauce-core/helpers/event";

import { ProfilePointer } from "nostr-tools/nip19";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue } from "applesauce-core/helpers/event-tags";
import { getProfilePointerFromPTag } from "applesauce-core/helpers/pointers";
import { isPTag, isRTag, isTTag } from "applesauce-core/helpers/tags";

// NIP-52 Calendar Event Kinds
export const DATE_BASED_CALENDAR_EVENT_KIND = 31922;
export const TIME_BASED_CALENDAR_EVENT_KIND = 31923;

// Calendar Event Participant
export type CalendarEventParticipant = ProfilePointer & {
  role?: string;
};

// Cache symbols for complex operations only
export const CalendarEventLocationsSymbol = Symbol.for("calendar-event-locations");
export const CalendarEventParticipantsSymbol = Symbol.for("calendar-event-participants");
export const CalendarEventHashtagsSymbol = Symbol.for("calendar-event-hashtags");
export const CalendarEventReferencesSymbol = Symbol.for("calendar-event-references");
export const CalendarEventGeohashSymbol = Symbol.for("calendar-event-geohash");

/** Gets the title of a calendar event or calendar */
export function getCalendarEventTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title") || getTagValue(event, "name"); // fallback to deprecated "name" tag
}

/** Gets the summary of a calendar event */
export function getCalendarEventSummary(event: NostrEvent): string | undefined {
  return getTagValue(event, "summary");
}

/** Gets the image URL of a calendar event */
export function getCalendarEventImage(event: NostrEvent): string | undefined {
  return getTagValue(event, "image");
}

/** Gets the start Unix timestamp of a calendar event */
export function getCalendarEventStart(event: NostrEvent): number | undefined {
  const value = getTagValue(event, "start");
  if (!value) return undefined;

  if (event.kind === DATE_BASED_CALENDAR_EVENT_KIND) return new Date(value).valueOf() / 1000;
  else if (event.kind === TIME_BASED_CALENDAR_EVENT_KIND) return parseInt(value);
  else return undefined;
}

/** Gets the timezone of the start timestamp of a calendar event */
export function getCalendarEventStartTimezone(event: NostrEvent): string | undefined {
  if (event.kind === DATE_BASED_CALENDAR_EVENT_KIND) return undefined;
  return getTagValue(event, "start_tzid");
}

/** Gets the timezone of the end timestamp of a calendar event */
export function getCalendarEventEndTimezone(event: NostrEvent): string | undefined {
  if (event.kind === DATE_BASED_CALENDAR_EVENT_KIND) return undefined;
  return getTagValue(event, "end_tzid");
}

/** Gets the end Unix timestamp of a calendar event */
export function getCalendarEventEnd(event: NostrEvent): number | undefined {
  const value = getTagValue(event, "end");
  if (!value) return undefined;

  if (event.kind === DATE_BASED_CALENDAR_EVENT_KIND) return new Date(value).valueOf() / 1000;
  else if (event.kind === TIME_BASED_CALENDAR_EVENT_KIND) return parseInt(value);
  else return undefined;
}

/** Gets all locations from a calendar event */
export function getCalendarEventLocations(event: NostrEvent): string[] {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a date-based or time-based calendar event");

  return getOrComputeCachedValue(event, CalendarEventLocationsSymbol, () => {
    return event.tags.filter((t) => t[0] === "location" && t[1]).map((t) => t[1]);
  });
}

/** Gets the geohash of a calendar event */
export function getCalendarEventGeohash(event: NostrEvent): string | undefined {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a date-based or time-based calendar event");

  return getOrComputeCachedValue(event, CalendarEventGeohashSymbol, () => {
    let hash: string | undefined = undefined;
    for (const tag of event.tags) {
      if (tag[0] === "g" && tag[1] && (!hash || tag[1].length > hash.length)) hash = tag[1];
    }
    return hash;
  });
}

/** Gets all participants from a calendar event */
export function getCalendarEventParticipants(event: NostrEvent): CalendarEventParticipant[] {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a date-based or time-based calendar event");

  return getOrComputeCachedValue(event, CalendarEventParticipantsSymbol, () => {
    return event.tags.filter(isPTag).map((tag) => ({
      ...getProfilePointerFromPTag(tag),
      // Third index of tag is optional "role"
      role: tag[3] || undefined,
    }));
  });
}

/** Gets all hashtags from a calendar event */
export function getCalendarEventHashtags(event: NostrEvent): string[] {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a date-based or time-based calendar event");

  return getOrComputeCachedValue(event, CalendarEventHashtagsSymbol, () => {
    return event.tags.filter(isTTag).map((t) => t[1]);
  });
}

/** Gets all references from a calendar event */
export function getCalendarEventReferences(event: NostrEvent): string[] {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a date-based or time-based calendar event");

  return getOrComputeCachedValue(event, CalendarEventReferencesSymbol, () => {
    return event.tags.filter(isRTag).map((t) => t[1]);
  });
}
