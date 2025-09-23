import { NostrEvent } from "nostr-tools";
import { getOrComputeCachedValue } from "./cache.js";
import { isSafeRelayURL } from "./relays.js";
import { isRTag } from "./tags.js";
import { normalizeURL } from "./url.js";

export const MailboxesInboxesSymbol = Symbol.for("mailboxes-inboxes");
export const MailboxesOutboxesSymbol = Symbol.for("mailboxes-outboxes");

/** Parses a 10002 event and stores the inboxes in the event using the {@link MailboxesInboxesSymbol} symbol */
export function getInboxes(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, MailboxesInboxesSymbol, () => {
    const inboxes: string[] = [];

    for (const tag of event.tags) {
      if (!isRTag(tag)) continue;

      try {
        const [, url, mode] = tag;

        if (url && isSafeRelayURL(url) && !inboxes.includes(url) && (mode === "read" || mode === undefined)) {
          inboxes.push(normalizeURL(url));
        }
      } catch {
        // Ignore invalid url tags
      }
    }

    return inboxes;
  });
}

/** Parses a 10002 event and stores the outboxes in the event using the {@link MailboxesOutboxesSymbol} symbol */
export function getOutboxes(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, MailboxesOutboxesSymbol, () => {
    const outboxes: string[] = [];

    for (const tag of event.tags) {
      if (!isRTag(tag)) continue;

      try {
        const [name, url, mode] = tag;

        if (
          name === "r" &&
          isSafeRelayURL(url) &&
          !outboxes.includes(url) &&
          (mode === "write" || mode === undefined)
        ) {
          outboxes.push(normalizeURL(url));
        }
      } catch {
        // Ignore invalid url tags
      }
    }

    return outboxes;
  });
}
