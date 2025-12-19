import {
  DATE_BASED_CALENDAR_EVENT_KIND,
  TIME_BASED_CALENDAR_EVENT_KIND,
} from "applesauce-common/helpers/calendar-event";
import * as Calendar from "applesauce-common/operations/calendar";
import { EventOperation } from "applesauce-core/event-factory";
import { AddressPointer } from "applesauce-core/helpers";
import { isEvent, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { firstValueFrom, of, timeout } from "rxjs";
import { Action } from "../action-hub.js";

function ModifyCalendarEvent(calendar: NostrEvent | AddressPointer, operations: EventOperation[]): Action {
  return async ({ factory, user, publish, events, sign }) => {
    const [event, outboxes] = await Promise.all([
      isEvent(calendar)
        ? Promise.resolve(calendar)
        : firstValueFrom(
            events.replaceable(kinds.Calendar, user.pubkey).pipe(timeout({ first: 1000, with: () => of(undefined) })),
          ),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!event) throw new Error("Calendar event not found");

    const signed = await factory.modify(event, ...operations).then(sign);
    await publish(signed, outboxes);
  };
}

/** Adds a calendar event to a calendar */
export function AddEventToCalendar(calendar: NostrEvent | AddressPointer, event: NostrEvent | AddressPointer): Action {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a calendar event");

  return ModifyCalendarEvent(calendar, [Calendar.addEvent(event)]);
}

/** Removes a calendar event from a calendar */
export function RemoveEventFromCalendar(
  calendar: NostrEvent | AddressPointer,
  event: NostrEvent | AddressPointer,
): Action {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a calendar event");

  return ModifyCalendarEvent(calendar, [Calendar.removeEvent(event)]);
}

/** Creates a new calendar event with title and events */
export function CreateCalendar(title: string, events?: (NostrEvent | AddressPointer)[]): Action {
  return async ({ factory, sign, publish, user }) => {
    const event = await factory
      .build(
        { kind: kinds.Calendar },
        Calendar.setTitle(title),
        ...(events?.map((event) => Calendar.addEvent(event)) ?? []),
      )
      .then(sign);
    await publish(event, await user.outboxes$.$first(1000, undefined));
  };
}
