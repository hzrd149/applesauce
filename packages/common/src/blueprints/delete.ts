import { blueprint } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { setContent } from "applesauce-core/operations";
import { setDeleteEvents } from "applesauce-core/operations/delete";

/** A blueprint for a NIP-09 delete event */
export function DeleteBlueprint(events: NostrEvent[], reason?: string) {
  return blueprint(kinds.EventDeletion, reason ? setContent(reason) : undefined, setDeleteEvents(events));
}
