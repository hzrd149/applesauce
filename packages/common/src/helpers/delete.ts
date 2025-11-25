import { NostrEvent } from "applesauce-core/helpers/event";

import { isATag, isETag } from "applesauce-core/helpers/tags";

export function getDeleteIds(deleteEvent: NostrEvent): string[] {
  return deleteEvent.tags.filter(isETag).map((t) => t[1]);
}

export function getDeleteCoordinates(deleteEvent: NostrEvent): string[] {
  return deleteEvent.tags.filter(isATag).map((t) => t[1]);
}
