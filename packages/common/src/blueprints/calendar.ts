import { blueprint, EventBlueprint } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";

import { addEvent, setTitle } from "../operations/calendar.js";

/** Creates a calendar event with a title and optional events */
export function CalendarBlueprint(title: string, events?: (NostrEvent | AddressPointer)[]): EventBlueprint {
  return blueprint(kinds.Calendar, setTitle(title), ...(events?.map((event) => addEvent(event)) ?? []));
}
