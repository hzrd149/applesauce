import { kinds, NostrEvent } from "nostr-tools";

import { blueprint } from "../../../factory/src/event-factory.jsnt-factory.js";
import { setContent } from "../../../factory/src/operations/content.jsoperations/content.js";
import { setDeleteEvents } from "../../../factory/src/operations/delete.jstions/delete.js";

/** A blueprint for a NIP-09 delete event */
export function DeleteBlueprint(events: NostrEvent[], reason?: string) {
  return blueprint(kinds.EventDeletion, reason ? setContent(reason) : undefined, setDeleteEvents(events));
}
