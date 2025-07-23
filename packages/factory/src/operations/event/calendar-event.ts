import { CalendarEventParticipant } from "applesauce-core/helpers";
import { createCalendarEventParticipantTag } from "../../helpers/calendar-event.js";
import { EventOperation } from "../../types.js";
import { includeNameValueTag, includeSingletonTag, modifyPublicTags } from "./tags.js";
import { addNameValueTag, removeNameValueTag, setSingletonTag } from "../tag/common.js";
import { removeGeohashTags, setGeohashTags } from "./geohash.js";

/** Sets the title of a calendar event */
export function calendarEventSetTitle(title: string): EventOperation {
  return includeSingletonTag(["title", title], true);
}

/** Sets the summary of a calendar event */
export function calendarEventSetSummary(summary: string): EventOperation {
  return includeSingletonTag(["summary", summary], true);
}

/** Sets the image for a calendar event */
export function calendarEventSetImage(image: string): EventOperation {
  return includeSingletonTag(["image", image], true);
}

/** Adds a participant to a calendar event */
export function calendarEventAddParticipant(participant: CalendarEventParticipant): EventOperation {
  return includeNameValueTag(createCalendarEventParticipantTag(participant), true);
}

/** Removes a participant from a calendar event */
export function calendarEventRemoveParticipant(pubkey: string | CalendarEventParticipant): EventOperation {
  return modifyPublicTags(removeNameValueTag(["p", typeof pubkey === "string" ? pubkey : pubkey.pubkey]));
}

/** Adds a location to a calendar event */
export function calendarEventAddLocation(location: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["location", location], true));
}

/** Removes a location from a calendar event */
export function calendarEventRemoveLocation(location: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["location", location]));
}

/** Removes a location from a calendar event */
export function calendarEventClearLocations(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => tag[0] !== "location"));
}

/** Sets the geohash for a calendar event */
export function calendarEventSetGeohash(geohash: string): EventOperation {
  return setGeohashTags(geohash);
}

/** Removes the geohash from a calendar event */
export function calendarEventRemoveGeohash(): EventOperation {
  return removeGeohashTags();
}

/** Sets the start date for a date based calendar event */
export function calendarEventSetStartDate(start: string | Date): EventOperation {
  const date = new Date(start).toISOString().split("T")[0];
  return includeSingletonTag(["start", date], true);
}

/** Sets the start time for a time based calendar event */
export function calendarEventSetStartTime(start: number | Date, timezone?: string): EventOperation {
  const timestamp = typeof start === "number" ? start : Math.round(new Date(start).valueOf() / 1000);
  return modifyPublicTags(
    setSingletonTag(["start", String(timestamp)], true),
    timezone ? setSingletonTag(["start_tzid", timezone], true) : undefined,
  );
}

/** Sets the end date for a date based calendar event */
export function calendarEventSetEndDate(end: string | Date): EventOperation {
  const date = new Date(end).toISOString().split("T")[0];
  return includeSingletonTag(["end", date], true);
}

/** Sets the end time for a time based calendar event */
export function calendarEventSetEndTime(end: number | Date, timezone?: string): EventOperation {
  const timestamp = typeof end === "number" ? end : Math.round(new Date(end).valueOf() / 1000);
  return modifyPublicTags(
    setSingletonTag(["end", String(timestamp)], true),
    timezone ? setSingletonTag(["end_tzid", timezone], true) : undefined,
  );
}
