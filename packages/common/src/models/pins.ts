import { Model } from "applesauce-core/event-store";
import { kinds } from "applesauce-core/helpers/event";
import { EventPointer, getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { isETag, processTags } from "applesauce-core/helpers/tags";
import { map } from "rxjs/operators";

/** A model that returns all pinned pointers for a user */
export function UserPinnedModel(pubkey: string): Model<EventPointer[] | undefined> {
  return (events) =>
    events
      .replaceable(kinds.Pinlist, pubkey)
      .pipe(map((event) => event && processTags(event.tags.filter(isETag), getEventPointerFromETag)));
}
