import { CalendarFactory } from "applesauce-common/factories";
import {
  DATE_BASED_CALENDAR_EVENT_KIND,
  TIME_BASED_CALENDAR_EVENT_KIND,
} from "applesauce-common/helpers/calendar-event";
import { AddressPointer } from "applesauce-core/helpers";
import { isEvent, NostrEvent } from "applesauce-core/helpers/event";
import { firstValueFrom, of, timeout } from "rxjs";
import { Action, ActionContext } from "../action-runner.js";

async function modifyCalendar(
  calendar: NostrEvent | AddressPointer,
  { events, user }: ActionContext,
): Promise<[CalendarFactory, string[] | undefined]> {
  const [calendarEvent, outboxes] = await Promise.all([
    isEvent(calendar)
      ? Promise.resolve(calendar)
      : firstValueFrom(events.replaceable(calendar).pipe(timeout({ first: 1000, with: () => of(undefined) }))),
    user.outboxes$.$first(1000, undefined),
  ]);

  if (!calendarEvent) throw new Error("Calendar event not found");

  return [CalendarFactory.modify(calendarEvent), outboxes];
}

/** Adds a calendar event to a calendar */
export function AddEventToCalendar(calendar: NostrEvent | AddressPointer, event: NostrEvent | AddressPointer): Action {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a calendar event");

  return async (context) => {
    const [factory, outboxes] = await modifyCalendar(calendar, context);
    const signed = await factory.addEvent(event).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Removes a calendar event from a calendar */
export function RemoveEventFromCalendar(
  calendar: NostrEvent | AddressPointer,
  event: NostrEvent | AddressPointer,
): Action {
  if (event.kind !== DATE_BASED_CALENDAR_EVENT_KIND && event.kind !== TIME_BASED_CALENDAR_EVENT_KIND)
    throw new Error("Event is not a calendar event");

  return async (context) => {
    const [factory, outboxes] = await modifyCalendar(calendar, context);
    const signed = await factory.removeEvent(event).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Creates a new calendar with a title and optional events */
export function CreateCalendar(title: string, events?: (NostrEvent | AddressPointer)[]): Action {
  return async ({ signer, publish, user }) => {
    let factory = CalendarFactory.create(title);
    for (const event of events ?? []) factory = factory.addEvent(event);
    const signed = await factory.sign(signer);
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
