import { isKind } from "nostr-tools/kinds";
import { kinds, KnownEvent, KnownEventTemplate } from "../helpers/event.js";
import {
  addInboxRelay,
  addMailboxRelay,
  addOutboxRelay,
  removeInboxRelay,
  removeMailboxRelay,
  removeOutboxRelay,
  setInboxRelays,
  setOutboxRelays,
} from "../operations/mailboxes.js";
import { blankEventTemplate, EventFactory, toEventTemplate } from "./event.js";

export type MailboxesTemplate = KnownEventTemplate<kinds.RelayList>;

/** A factory class for building NIP-65 relay list (mailboxes) events */
export class MailboxesFactory extends EventFactory<kinds.RelayList, MailboxesTemplate> {
  /**
   * Creates a new mailboxes factory
   * @returns A new mailboxes factory
   */
  static create(): MailboxesFactory {
    return new MailboxesFactory((res) => res(blankEventTemplate(kinds.RelayList)));
  }

  /**
   * Creates a new mailboxes factory from an existing relay list event with validation
   * @param event - The existing relay list event
   * @returns A new mailboxes factory
   */
  static modify(event: KnownEvent<kinds.RelayList>): MailboxesFactory {
    if (!isKind(event, kinds.RelayList)) throw new Error("Event is not a relay list");
    return new MailboxesFactory((res) => res(toEventTemplate(event)));
  }

  /** Adds an outbox relay (write) */
  addOutbox(url: string | URL) {
    return this.chain(addOutboxRelay(url));
  }

  /** Removes an outbox relay (write) */
  removeOutbox(url: string | URL) {
    return this.chain(removeOutboxRelay(url));
  }

  /** Adds an inbox relay (read) */
  addInbox(url: string | URL) {
    return this.chain(addInboxRelay(url));
  }

  /** Removes an inbox relay (read) */
  removeInbox(url: string | URL) {
    return this.chain(removeInboxRelay(url));
  }

  /** Adds a relay as both inbox and outbox */
  addRelay(url: string | URL) {
    return this.chain(addMailboxRelay(url));
  }

  /** Completely removes a relay from mailboxes */
  removeRelay(url: string | URL) {
    return this.chain(removeMailboxRelay(url));
  }

  /** Sets all inbox relays (read), replacing existing ones */
  inboxes(urls: (string | URL)[]) {
    return this.chain(setInboxRelays(urls));
  }

  /** Sets all outbox relays (write), replacing existing ones */
  outboxes(urls: (string | URL)[]) {
    return this.chain(setOutboxRelays(urls));
  }
}
