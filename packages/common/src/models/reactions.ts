import { getEventUID, isReplaceable, NostrEvent, kinds } from "applesauce-core/helpers/event";
import { Model } from "applesauce-core/event-store";
import { type Observable } from "rxjs";

// Import EventModels as a value (class) to modify its prototype
import { EventModels } from "applesauce-core/event-store";

/** A model that returns all reactions to an event (supports replaceable events) */
export function ReactionsModel(event: NostrEvent): Model<NostrEvent[]> {
  return (events) =>
    events.timeline(
      isReplaceable(event.kind)
        ? [
            { kinds: [kinds.Reaction], "#e": [event.id] },
            { kinds: [kinds.Reaction], "#a": [getEventUID(event)] },
          ]
        : [
            {
              kinds: [kinds.Reaction],
              "#e": [event.id],
            },
          ],
    );
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
