import { kinds, NostrEvent } from "nostr-tools";
import { AddressPointer } from "nostr-tools/nip19";

import { blueprint, EventBlueprint } from "../index.js";
import { addEvent, setTitle } from "../operations/calendar.js";

/** Creates a calendar event with a title and optional events */
export function CalendarBlueprint(title: string, events?: (NostrEvent | AddressPointer)[]): EventBlueprint {
  return blueprint(kinds.Calendar, setTitle(title), ...(events?.map((event) => addEvent(event)) ?? []));
}
