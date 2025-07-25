import { DATE_BASED_CALENDAR_EVENT_KIND, TIME_BASED_CALENDAR_EVENT_KIND } from "applesauce-core/helpers/calendar-event";
import { Calendar } from "applesauce-factory/operations";
import { kinds, NostrEvent } from "nostr-tools";

import { Action } from "../action-hub.js";

/** Adds a calendar event to a calendar */
export function AddEventToCalendar(calendar: NostrEvent, event: NostrEvent): Action {
  if (calendar.kind !== kinds.Calendar) throw new Error("Calendar is not a calendar event");
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a calendar event");

  return async function* ({ factory }) {
    const draft = await factory.modify(calendar, Calendar.addEvent(event));
    return await factory.sign(draft);
  };
}

/** Removes a calendar event from a calendar */
export function RemoveEventFromCalendar(calendar: NostrEvent, event: NostrEvent): Action {
  if (calendar.kind !== kinds.Calendar) throw new Error("Calendar is not a calendar event");
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a calendar event");

  return async function* ({ factory }) {
    const draft = await factory.modify(calendar, Calendar.removeEvent(event));
    return await factory.sign(draft);
  };
}
