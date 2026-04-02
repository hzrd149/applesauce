import { EventOperation } from "applesauce-core/factories";
import { addNameValueTag, removeNameValueTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { includeNameValueTag, includeSingletonTag, modifyPublicTags } from "applesauce-core/operations/tags";
import { createCalendarEventParticipantTag } from "../helpers/calendar-event.js";
import { CalendarEventParticipant } from "../helpers/calendar-event.js";
import * as Geohash from "./geohash.js";

/** Sets the title of a calendar event */
export function setTitle(title: string): EventOperation {
  return includeSingletonTag(["title", title], true);
}

/** Sets the summary of a calendar event */
export function setSummary(summary: string): EventOperation {
  return includeSingletonTag(["summary", summary], true);
}

/** Sets the image for a calendar event */
export function setImage(image: string): EventOperation {
  return includeSingletonTag(["image", image], true);
}

/** Adds a participant to a calendar event */
export function addParticipant(participant: CalendarEventParticipant): EventOperation {
  return includeNameValueTag(createCalendarEventParticipantTag(participant), true);
}

/** Removes a participant from a calendar event */
export function removeParticipant(pubkey: string | CalendarEventParticipant): EventOperation {
  return modifyPublicTags(removeNameValueTag(["p", typeof pubkey === "string" ? pubkey : pubkey.pubkey]));
}

/** Adds a location to a calendar event */
export function addLocation(location: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["location", location], true));
}

/** Removes a location from a calendar event */
export function removeLocation(location: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["location", location]));
}

/** Adds a location to a calendar event */
export function addReferenceLink(link: string | URL): EventOperation {
  return modifyPublicTags(addNameValueTag(["r", new URL(link).toString()], true));
}

/** Removes a location from a calendar event */
export function removeReferenceLink(link: string | URL): EventOperation {
  return modifyPublicTags(removeNameValueTag(["r", new URL(link).toString()]));
}

/** Removes all locations from a calendar event */
export function clearLocations(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => tag[0] !== "location"));
}

/** Sets the geohash for a calendar event */
export function setGeohash(geohash: string): EventOperation {
  return Geohash.setGeohash(geohash);
}

/** Removes the geohash from a calendar event */
export function removeGeohash(): EventOperation {
  return Geohash.removeGeohash();
}

/** Sets the start date for a date based calendar event */
export function setStartDate(start: string | Date): EventOperation {
  const date = new Date(start).toISOString().split("T")[0];
  return includeSingletonTag(["start", date], true);
}

/** Sets the start time for a time based calendar event */
export function setStartTime(start: number | Date, timezone?: string): EventOperation {
  const timestamp = typeof start === "number" ? start : Math.round(new Date(start).valueOf() / 1000);
  return modifyPublicTags(
    setSingletonTag(["start", String(timestamp)], true),
    timezone ? setSingletonTag(["start_tzid", timezone], true) : undefined,
  );
}

/** Sets the end date for a date based calendar event */
export function setEndDate(end: string | Date): EventOperation {
  const date = new Date(end).toISOString().split("T")[0];
  return includeSingletonTag(["end", date], true);
}

/** Sets the end time for a time based calendar event */
export function setEndTime(end: number | Date, timezone?: string): EventOperation {
  const timestamp = typeof end === "number" ? end : Math.round(new Date(end).valueOf() / 1000);
  return modifyPublicTags(
    setSingletonTag(["end", String(timestamp)], true),
    timezone ? setSingletonTag(["end_tzid", timezone], true) : undefined,
  );
}
