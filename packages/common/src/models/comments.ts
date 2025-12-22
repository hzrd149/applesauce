import { EventModels, Model } from "applesauce-core/event-store";
import { createReplaceableAddress, isEvent, NostrEvent } from "applesauce-core/helpers/event";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers/model";
import { of, type Observable } from "rxjs";
import { COMMENT_KIND, CommentPointer } from "../helpers/comment.js";

/** A model that returns all NIP-22 comment replies for the event */
export function CommentsModel(parent: NostrEvent | CommentPointer): Model<NostrEvent[]> {
  return (events) => {
    if (isEvent(parent)) return events.timeline(buildCommonEventRelationFilters({ kinds: [COMMENT_KIND] }, parent));
    else {
      switch (parent.type) {
        case "event":
          return events.timeline({ kinds: [COMMENT_KIND], "#e": [parent.id] });
        case "address":
          return events.timeline({
            kinds: [COMMENT_KIND],
            "#a": [createReplaceableAddress(parent.kind, parent.pubkey, parent.identifier)],
          });
        default:
          return of([]);
      }
    }
  };
}

// Register this model with EventModels
EventModels.prototype.comments = function (event: NostrEvent | CommentPointer) {
  return this.model(CommentsModel, event);
};

// Type augmentation for EventModels
declare module "applesauce-core/event-store" {
  interface EventModels {
    /** Subscribe to an event's comments */
    comments(event: NostrEvent | CommentPointer): Observable<NostrEvent[]>;
  }
}
