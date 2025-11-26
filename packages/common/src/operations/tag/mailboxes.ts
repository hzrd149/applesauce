import { isRTag, isSameURL, normalizeURL } from "applesauce-core/helpers";
import { addRelayTag, removeRelayTag } from "./relay.js";
import { TagOperation } from "applesauce-core/factory-types.js";

function findMatchingRTag(tags: string[][], url: string | URL) {
  return tags.filter(isRTag).find((t) => isSameURL(t[1], url));
}

/** Add an outbox relay in NIP-65 mailboxes */
export function addOutboxRelay(url: string | URL): TagOperation {
  url = normalizeURL(url).toString();

  return (tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is an inbox, remove the marker so its both
      if (existing[2] === "read") return tags.map((t) => (t === existing ? ["r", url] : t));
      else return tags;
    } else return [...tags, ["r", url, "write"]];
  };
}

/** Remove an outbox relay in NIP-65 mailboxes */
export function removeOutboxRelay(url: string | URL): TagOperation {
  url = normalizeURL(url).toString();

  return (tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is both, change it to an inbox
      if (existing[2] === undefined) return tags.map((t) => (t === existing ? ["r", url, "read"] : t));
      else return tags.filter((t) => t !== existing);
    } else return tags;
  };
}

/** Adds an inbox relay in NIP-65 mailboxes */
export function addInboxRelay(url: string | URL): TagOperation {
  url = normalizeURL(url).toString();

  return (tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is an outbox, remove the marker so its both
      if (existing[2] === "write") return tags.map((t) => (t === existing ? ["r", url] : t));
      else return tags;
    } else return [...tags, ["r", url, "read"]];
  };
}

/** Remove an inbox relay in NIP-65 mailboxes */
export function removeInboxRelay(url: string | URL): TagOperation {
  url = normalizeURL(url).toString();

  return (tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is both, change it to an outbox
      if (existing[2] === undefined) return tags.map((t) => (t === existing ? ["r", url, "write"] : t));
      else return tags.filter((t) => t !== existing);
    } else return tags;
  };
}

/** Adds an inbox and outbox relay to NIP-65 */
export function addMailboxRelay(url: string | URL): TagOperation {
  // set replace=true so any existing "read" or "write" tags are overwritten
  return addRelayTag(url, "r", true);
}

/** Completely removes a mailbox relay from NIP-65 */
export function removeMailboxRelay(url: string | URL): TagOperation {
  return removeRelayTag(url, "r");
}


