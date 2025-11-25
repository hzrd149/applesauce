import { CalendarEventParticipant } from "applesauce-common/helpers/calendar-event";
import { NameValueTag } from "applesauce-core/helpers/tags";
import { createPTagFromProfilePointer } from "./pointer.js";
import { fillAndTrimTag } from "./tag.js";

/** Creates a "p" tag for a calendar event participant */
export function createCalendarEventParticipantTag(participant: CalendarEventParticipant): NameValueTag {
  const tag = createPTagFromProfilePointer(participant);

  // Add the third "role" value if set
  if (participant.role) {
    tag[3] = participant.role;
    return fillAndTrimTag(tag, 3) as NameValueTag;
  }

  return tag as NameValueTag;
}
