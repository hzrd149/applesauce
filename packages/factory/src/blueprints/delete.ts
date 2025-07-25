import { kinds, NostrEvent } from "nostr-tools";

import { blueprint } from "../event-factory.js";
import { setContent } from "../operations/content.js";
import { setDeleteEvents } from "../operations/delete.js";

/** A blueprint for a NIP-09 delete event */
export function DeleteBlueprint(events: NostrEvent[], reason?: string) {
  return blueprint(kinds.EventDeletion, reason ? setContent(reason) : undefined, setDeleteEvents(events));
}
