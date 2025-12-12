import { EventModels, Model } from "applesauce-core/event-store";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { buildCommonEventRelationFilters } from "applesauce-core/helpers/model";
import { type Observable } from "rxjs";

/** A model that returns all reactions to an event (supports replaceable events) */
export function ReactionsModel(event: NostrEvent): Model<NostrEvent[]> {
  return (events) => events.timeline(buildCommonEventRelationFilters({ kinds: [kinds.Reaction] }, event));
}

// Register this model with EventModels
EventModels.prototype.reactions = function (event: NostrEvent) {
  return this.model(ReactionsModel, event);
};

// Type augmentation for EventModels
declare module "applesauce-core/event-store" {
  interface EventModels {
    /** Subscribe to an event's reactions */
    reactions(event: NostrEvent): Observable<NostrEvent[]>;
  }
}
