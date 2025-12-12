import { EventModels, Model } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers/model";
import { type Observable } from "rxjs";
import { COMMENT_KIND } from "../helpers/comment.js";

/** A model that returns all NIP-22 comment replies for the event */
export function CommentsModel(parent: NostrEvent): Model<NostrEvent[]> {
  return (events) => events.timeline(buildCommonEventRelationFilters({ kinds: [COMMENT_KIND] }, parent));
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
