import { blueprint } from "applesauce-core/event-factory";
import { EventTemplate, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { setContent } from "applesauce-core/operations";
import { setDeleteEvents } from "applesauce-core/operations/delete";

// Import EventFactory as a value (class) to modify its prototype
import { EventFactory } from "applesauce-core/event-factory";

/** A blueprint for a NIP-09 delete event */
export function DeleteBlueprint(events: NostrEvent[], reason?: string) {
  return blueprint(kinds.EventDeletion, reason ? setContent(reason) : undefined, setDeleteEvents(events));
}

// Register this blueprint with EventFactory
EventFactory.prototype.delete = function (events: NostrEvent[], reason?: string) {
  return this.create(DeleteBlueprint, events, reason);
};

// Type augmentation for EventFactory
declare module "applesauce-core/event-factory" {
  interface EventFactory {
    /** Create a NIP-09 delete event */
    delete(events: NostrEvent[], reason?: string): Promise<EventTemplate>;
  }
}
