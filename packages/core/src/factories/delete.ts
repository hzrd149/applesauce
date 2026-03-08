import { kinds, NostrEvent } from "nostr-tools";
import { KnownEventTemplate } from "../helpers/event.js";
import { blankEventTemplate, EventFactory } from "./event.js";
import { setDeleteEvents } from "../operations/delete.js";

export type DeleteTemplate = KnownEventTemplate<kinds.EventDeletion>;

/** A factory class for building delete events */
export class DeleteFactory extends EventFactory<kinds.EventDeletion, DeleteTemplate> {
  /**
   * Creates a new delete factory from a list of event ids
   * @param events - The list of event ids to delete
   * @param reason - The reason for the deletion
   * @returns A new delete factory
   */
  static fromEvents(events: (string | NostrEvent)[], reason = ""): DeleteFactory {
    return new DeleteFactory((res) => res(blankEventTemplate(kinds.EventDeletion))).events(events).reason(reason);
  }

  /** Sets the reason for the deletion */
  reason(reason: string) {
    return this.content(reason);
  }

  /** Sets the events to delete */
  events(events: (string | NostrEvent)[]) {
    return this.chain(setDeleteEvents(events));
  }
}
