import { Model } from "applesauce-core/event-store";
import { getReplaceableAddress } from "applesauce-core/helpers/event";
import { defined } from "applesauce-core/observable";
import { NostrEvent } from "applesauce-core/helpers/event";
import { combineLatest, EMPTY } from "rxjs";

import { CALENDAR_EVENT_RSVP_KIND } from "../helpers/calendar-rsvp.js";
import { getCalendarAddressPointers } from "../helpers/calendar.js";

/** A model that gets all the events for a calendar */
export function CalendarEventsModel(calendar: NostrEvent): Model<NostrEvent[]> {
  return (events) =>
    combineLatest(
      getCalendarAddressPointers(calendar).map((p) =>
        events.replaceable(p.kind, p.pubkey, p.identifier).pipe(defined()),
      ),
    );
}

/** A model that gets all the RSVPs for a calendar event */
export function CalendarEventRSVPsModel(event: NostrEvent): Model<NostrEvent[]> {
  return (events) => {
    const address = getReplaceableAddress(event);
    if (!address) return EMPTY;
    return events.timeline({ kinds: [CALENDAR_EVENT_RSVP_KIND], "#a": [address] });
  };
}
