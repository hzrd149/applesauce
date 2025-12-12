import { getInboxes, getOutboxes, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers";
import { BaseCast } from "./common.js";

function isValidMailboxes(event: NostrEvent): event is KnownEvent<kinds.RelayList> {
  return event.kind === kinds.RelayList;
}

/** Cast for NIP-65 relay list events */
export class Mailboxes extends BaseCast<kinds.RelayList> {
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
