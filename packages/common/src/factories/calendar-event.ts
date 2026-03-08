import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { setContent } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { includeReplaceableIdentifier } from "applesauce-core/operations/index";
import { DATE_BASED_CALENDAR_EVENT_KIND, TIME_BASED_CALENDAR_EVENT_KIND } from "../helpers/calendar-event.js";
import * as CalendarEventOps from "../operations/calendar-event.js";
import { CalendarEventParticipant } from "../helpers/calendar-event.js";

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
      .identifier(crypto.randomUUID().replace(/-/g, ""))
      .title(title);
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

  /** Adds a reference link to the calendar event */
  referenceLink(link: string | URL) {
    return this.chain(CalendarEventOps.addReferenceLink(link));
  }

  /** Adds a participant to the calendar event */
  participant(participant: CalendarEventParticipant) {
    return this.chain(CalendarEventOps.addParticipant(participant));
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
      .identifier(crypto.randomUUID().replace(/-/g, ""))
      .title(title);
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

  /** Adds a reference link to the calendar event */
  referenceLink(link: string | URL) {
    return this.chain(CalendarEventOps.addReferenceLink(link));
  }

  /** Adds a participant to the calendar event */
  participant(participant: CalendarEventParticipant) {
    return this.chain(CalendarEventOps.addParticipant(participant));
  }

  /** Sets meta tags */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }
}
