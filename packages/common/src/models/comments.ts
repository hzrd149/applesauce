import { Model } from "applesauce-core/event-store";
import { getReplaceableAddress, isAddressableKind, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { type Observable } from "rxjs";

import { COMMENT_KIND } from "../helpers/comment.js";

// Import EventModels as a value (class) to modify its prototype
import { EventModels } from "applesauce-core/event-store";

/** A model that returns all NIP-22 comment replies for the event */
export function CommentsModel(parent: NostrEvent): Model<NostrEvent[]> {
  return (events) => {
    const filters: Filter[] = [{ kinds: [COMMENT_KIND], "#e": [parent.id] }];
    if (isAddressableKind(parent.kind)) filters.push({ kinds: [COMMENT_KIND], "#a": [getReplaceableAddress(parent)] });

    return events.timeline(filters);
  };
}

// Register this model with EventModels
EventModels.prototype.comments = function (event: NostrEvent) {
  return this.model(CommentsModel, event);
};

// Type augmentation for EventModels
declare module "applesauce-core/event-store" {
  interface EventModels {
    /** Subscribe to an event's comments */
    comments(event: NostrEvent): Observable<NostrEvent[]>;
  }
}
