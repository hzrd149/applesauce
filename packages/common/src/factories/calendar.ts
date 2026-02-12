import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { addEvent, removeEvent, setTitle } from "../operations/calendar.js";

export type CalendarTemplate = KnownEventTemplate<kinds.Calendar>;

export class CalendarFactory extends EventFactory<kinds.Calendar, CalendarTemplate> {
  /** Creates a new calendar event */
  static create(title: string): CalendarFactory {
    return new CalendarFactory((res) => res(blankEventTemplate(kinds.Calendar))).title(title);
  }

  /** Modify a calendar event */
  static modify(event: NostrEvent | KnownEvent<kinds.Calendar>): CalendarFactory {
    if (!isKind(event, kinds.Calendar)) throw new Error("Event is not a calendar event");
    return new CalendarFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the title of the calendar */
  title(title: string) {
    return this.chain(setTitle(title));
  }

  /** Adds a calendar event to the calendar */
  addEvent(event: NostrEvent | AddressPointer) {
    return this.chain(addEvent(event));
  }

  /** Removes a calendar event from the calendar */
  removeEvent(event: NostrEvent | AddressPointer) {
    return this.chain(removeEvent(event));
  }
}
