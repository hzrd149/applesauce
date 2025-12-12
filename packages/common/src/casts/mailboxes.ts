import { getInboxes, getOutboxes, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers";
import { Cast } from "./cast.js";

function isValidMailboxes(event: NostrEvent): event is KnownEvent<kinds.RelayList> {
  return event.kind === kinds.RelayList;
}

/** Cast for NIP-65 relay list events */
export class Mailboxes extends Cast<KnownEvent<kinds.RelayList>> {
  constructor(event: NostrEvent) {
    if (!isValidMailboxes(event)) throw new Error("Invalid mailboxes");
    super(event);
  }

  get inboxes() {
    return getInboxes(this.event);
  }
  get outboxes() {
    return getOutboxes(this.event);
  }
}
