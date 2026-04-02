import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { CALENDAR_EVENT_RSVP_KIND, RSVPFreeBusy, RSVPStatus } from "../helpers/calendar-rsvp.js";
import * as CalendarRsvpOps from "../operations/calendar-rsvp.js";

export type CalendarEventRSVPTemplate = KnownEventTemplate<typeof CALENDAR_EVENT_RSVP_KIND>;

/** A factory class for building NIP-52 calendar event RSVP events (kind 31925) */
export class CalendarEventRSVPFactory extends EventFactory<typeof CALENDAR_EVENT_RSVP_KIND, CalendarEventRSVPTemplate> {
  /**
   * Creates a new RSVP factory for a calendar event
   * @param calendarEvent - The calendar event being RSVPed to
   * @param status - The RSVP status (accepted, declined, tentative)
   */
  static create(
    calendarEvent: NostrEvent | AddressPointer,
    status: RSVPStatus,
    relay?: string,
  ): CalendarEventRSVPFactory {
    return new CalendarEventRSVPFactory((res) => res(blankEventTemplate(CALENDAR_EVENT_RSVP_KIND)))
      .calendarEvent(calendarEvent, relay)
      .status(status);
  }

  /** Creates a factory from an existing RSVP event for editing */
  static modify(event: NostrEvent | KnownEvent<typeof CALENDAR_EVENT_RSVP_KIND>): CalendarEventRSVPFactory {
    if (!isKind(event, CALENDAR_EVENT_RSVP_KIND)) throw new Error("Event is not a calendar event RSVP");
    return new CalendarEventRSVPFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the pointer to the calendar event being RSVPed to */
  calendarEvent(pointer: NostrEvent | AddressPointer, relay?: string) {
    return this.chain(CalendarRsvpOps.setCalendarEvent(pointer, relay));
  }

  /** Sets the RSVP status */
  status(status: RSVPStatus) {
    return this.chain(CalendarRsvpOps.setStatus(status));
  }

  /** Sets the free/busy status for the time slot */
  freeBusy(freeBusy: RSVPFreeBusy) {
    return this.chain(CalendarRsvpOps.setFreeBusy(freeBusy));
  }
}
