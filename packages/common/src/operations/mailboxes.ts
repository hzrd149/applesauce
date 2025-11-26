import { modifyPublicTags } from "./tags.js";
import * as TagOperations from "./tag/mailboxes.js";
import { EventOperation } from "../types.js";

/** Add an outbox relay in NIP-65 mailboxes */
export function addOutboxRelay(url: string | URL): EventOperation {
  return modifyPublicTags(TagOperations.addOutboxRelay(url));
}

/** Remove an outbox relay in NIP-65 mailboxes */
export function removeOutboxRelay(url: string | URL): EventOperation {
  return modifyPublicTags(TagOperations.removeOutboxRelay(url));
}

/** Adds an inbox relay in NIP-65 mailboxes */
export function addInboxRelay(url: string | URL): EventOperation {
  return modifyPublicTags(TagOperations.addInboxRelay(url));
}

/** Remove an inbox relay in NIP-65 mailboxes */
export function removeInboxRelay(url: string | URL): EventOperation {
  return modifyPublicTags(TagOperations.removeInboxRelay(url));
}

/** Adds an inbox and outbox relay to NIP-65 */
export function addMailboxRelay(url: string | URL): EventOperation {
  return modifyPublicTags(TagOperations.addMailboxRelay(url));
}

/** Completely removes a mailbox relay from NIP-65 */
export function removeMailboxRelay(url: string | URL): EventOperation {
  return modifyPublicTags(TagOperations.removeMailboxRelay(url));
}
