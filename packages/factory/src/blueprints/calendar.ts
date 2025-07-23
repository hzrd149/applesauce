import { kinds, NostrEvent } from "nostr-tools";
import { AddressPointer } from "nostr-tools/nip19";

import { blueprint, EventBlueprint } from "../index.js";
import { calendarAddEvent, calendarSetTitle } from "../operations/event/calendar.js";

/** Creates a calendar event with a title and optional events */
export function CalendarBlueprint(title: string, events?: (NostrEvent | AddressPointer)[]): EventBlueprint {
  return blueprint(kinds.Calendar, calendarSetTitle(title), ...(events?.map((event) => calendarAddEvent(event)) ?? []));
}
