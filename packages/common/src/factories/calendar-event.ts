import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { nanoid } from "nanoid";
import { setContent } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { includeReplaceableIdentifier } from "applesauce-core/operations/index";
import {
  DATE_BASED_CALENDAR_EVENT_KIND,
  TIME_BASED_CALENDAR_EVENT_KIND,
  CalendarEventParticipant,
} from "../helpers/calendar-event.js";
import * as CalendarEventOps from "../operations/calendar-event.js";
import { addHashtag, includeHashtags } from "../operations/hashtags.js";

export type DateBasedCalendarEventTemplate = KnownEventTemplate<typeof DATE_BASED_CALENDAR_EVENT_KIND>;
export type TimeBasedCalendarEventTemplate = KnownEventTemplate<typeof TIME_BASED_CALENDAR_EVENT_KIND>;

/** A factory class for building NIP-52 date-based calendar events (kind 31922) */
export class DateBasedCalendarEventFactory extends EventFactory<
  typeof DATE_BASED_CALENDAR_EVENT_KIND,
  DateBasedCalendarEventTemplate
> {
  /** Creates a new date-based calendar event factory */
  static create(title: string): DateBasedCalendarEventFactory {
    return new DateBasedCalendarEventFactory((res) => res(blankEventTemplate(DATE_BASED_CALENDAR_EVENT_KIND)))
      .identifier(nanoid())
      .title(title);
  }

  /** Creates a factory from an existing date-based calendar event for editing */
  static modify(event: NostrEvent | KnownEvent<typeof DATE_BASED_CALENDAR_EVENT_KIND>): DateBasedCalendarEventFactory {
    if (!isKind(event, DATE_BASED_CALENDAR_EVENT_KIND)) throw new Error("Event is not a date-based calendar event");
    return new DateBasedCalendarEventFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the "d" identifier tag */
  identifier(id: string) {
    return this.chain(includeReplaceableIdentifier(id));
  }

  /** Sets the title of the calendar event */
  title(title: string) {
    return this.chain(CalendarEventOps.setTitle(title));
  }

  /** Sets the description/content of the calendar event */
  description(content: string) {
    return this.chain(setContent(content));
  }

  /** Sets the summary of the calendar event */
  summary(summary: string) {
    return this.chain(CalendarEventOps.setSummary(summary));
  }

  /** Sets the image for the calendar event */
  image(url: string) {
    return this.chain(CalendarEventOps.setImage(url));
  }

  /** Sets the start date (YYYY-MM-DD) */
  startDate(date: string | Date) {
    return this.chain(CalendarEventOps.setStartDate(date));
  }

  /** Sets the end date (YYYY-MM-DD) */
  endDate(date: string | Date) {
    return this.chain(CalendarEventOps.setEndDate(date));
  }

  /** Sets the geohash for the calendar event */
  geohash(geohash: string) {
    return this.chain(CalendarEventOps.setGeohash(geohash));
  }

  /** Adds a location to the calendar event */
  location(location: string) {
    return this.chain(CalendarEventOps.addLocation(location));
  }

  /** Removes a location from the calendar event */
  removeLocation(location: string) {
    return this.chain(CalendarEventOps.removeLocation(location));
  }

  /** Adds a reference link to the calendar event */
  referenceLink(link: string | URL) {
    return this.chain(CalendarEventOps.addReferenceLink(link));
  }

  /** Removes a reference link from the calendar event */
  removeReferenceLink(link: string | URL) {
    return this.chain(CalendarEventOps.removeReferenceLink(link));
  }

  /** Adds a participant to the calendar event */
  participant(participant: CalendarEventParticipant) {
    return this.chain(CalendarEventOps.addParticipant(participant));
  }

  /** Removes a participant from the calendar event */
  removeParticipant(pubkey: string | CalendarEventParticipant) {
    return this.chain(CalendarEventOps.removeParticipant(pubkey));
  }

  /** Adds a hashtag to the calendar event */
  addHashtag(hashtag: string) {
    return this.chain(addHashtag(hashtag));
  }

  /** Adds multiple hashtags to the calendar event */
  hashtags(hashtags: string[]) {
    return this.chain(includeHashtags(hashtags));
  }

  /** Sets meta tags */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }
}

/** A factory class for building NIP-52 time-based calendar events (kind 31923) */
export class TimeBasedCalendarEventFactory extends EventFactory<
  typeof TIME_BASED_CALENDAR_EVENT_KIND,
  TimeBasedCalendarEventTemplate
> {
  /** Creates a new time-based calendar event factory */
  static create(title: string): TimeBasedCalendarEventFactory {
    return new TimeBasedCalendarEventFactory((res) => res(blankEventTemplate(TIME_BASED_CALENDAR_EVENT_KIND)))
      .identifier(nanoid())
      .title(title);
  }

  /** Creates a factory from an existing time-based calendar event for editing */
  static modify(event: NostrEvent | KnownEvent<typeof TIME_BASED_CALENDAR_EVENT_KIND>): TimeBasedCalendarEventFactory {
    if (!isKind(event, TIME_BASED_CALENDAR_EVENT_KIND)) throw new Error("Event is not a time-based calendar event");
    return new TimeBasedCalendarEventFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the "d" identifier tag */
  identifier(id: string) {
    return this.chain(includeReplaceableIdentifier(id));
  }

  /** Sets the title of the calendar event */
  title(title: string) {
    return this.chain(CalendarEventOps.setTitle(title));
  }

  /** Sets the description/content of the calendar event */
  description(content: string) {
    return this.chain(setContent(content));
  }

  /** Sets the summary of the calendar event */
  summary(summary: string) {
    return this.chain(CalendarEventOps.setSummary(summary));
  }

  /** Sets the image for the calendar event */
  image(url: string) {
    return this.chain(CalendarEventOps.setImage(url));
  }

  /** Sets the start time */
  startTime(time: number | Date, timezone?: string) {
    return this.chain(CalendarEventOps.setStartTime(time, timezone));
  }

  /** Sets the end time */
  endTime(time: number | Date, timezone?: string) {
    return this.chain(CalendarEventOps.setEndTime(time, timezone));
  }

  /** Sets the geohash for the calendar event */
  geohash(geohash: string) {
    return this.chain(CalendarEventOps.setGeohash(geohash));
  }

  /** Adds a location to the calendar event */
  location(location: string) {
    return this.chain(CalendarEventOps.addLocation(location));
  }

  /** Removes a location from the calendar event */
  removeLocation(location: string) {
    return this.chain(CalendarEventOps.removeLocation(location));
  }

  /** Adds a reference link to the calendar event */
  referenceLink(link: string | URL) {
    return this.chain(CalendarEventOps.addReferenceLink(link));
  }

  /** Removes a reference link from the calendar event */
  removeReferenceLink(link: string | URL) {
    return this.chain(CalendarEventOps.removeReferenceLink(link));
  }

  /** Adds a participant to the calendar event */
  participant(participant: CalendarEventParticipant) {
    return this.chain(CalendarEventOps.addParticipant(participant));
  }

  /** Removes a participant from the calendar event */
  removeParticipant(pubkey: string | CalendarEventParticipant) {
    return this.chain(CalendarEventOps.removeParticipant(pubkey));
  }

  /** Adds a hashtag to the calendar event */
  addHashtag(hashtag: string) {
    return this.chain(addHashtag(hashtag));
  }

  /** Adds multiple hashtags to the calendar event */
  hashtags(hashtags: string[]) {
    return this.chain(includeHashtags(hashtags));
  }

  /** Sets meta tags */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }
}
