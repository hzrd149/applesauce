import { EventOperation } from "../event-factory/types.js";
import { isRTag } from "../helpers/tags.js";
import { isSameURL, normalizeURL } from "../helpers/url.js";
import { addRelayTag, removeRelayTag } from "./tag/relay.js";
import { modifyPublicTags } from "./tags.js";

function findMatchingRTag(tags: string[][], url: string | URL) {
  return tags.filter(isRTag).find((t) => isSameURL(t[1], url));
}

/** Add an outbox relay in NIP-65 mailboxes */
export function addOutboxRelay(url: string | URL): EventOperation {
  url = normalizeURL(url).toString();

  return modifyPublicTags((tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is an inbox, remove the marker so its both
      if (existing[2] === "read") return tags.map((t) => (t === existing ? ["r", url] : t));
      else return tags;
    } else return [...tags, ["r", url, "write"]];
  });
}

/** Remove an outbox relay in NIP-65 mailboxes */
export function removeOutboxRelay(url: string | URL): EventOperation {
  url = normalizeURL(url).toString();

  return modifyPublicTags((tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is both, change it to an inbox
      if (existing[2] === undefined) return tags.map((t) => (t === existing ? ["r", url, "read"] : t));
      else return tags.filter((t) => t !== existing);
    } else return tags;
  });
}

/** Adds an inbox relay in NIP-65 mailboxes */
export function addInboxRelay(url: string | URL): EventOperation {
  url = normalizeURL(url).toString();

  return modifyPublicTags((tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is an outbox, remove the marker so its both
      if (existing[2] === "write") return tags.map((t) => (t === existing ? ["r", url] : t));
      else return tags;
    } else return [...tags, ["r", url, "read"]];
  });
}

/** Remove an inbox relay in NIP-65 mailboxes */
export function removeInboxRelay(url: string | URL): EventOperation {
  url = normalizeURL(url).toString();

  return modifyPublicTags((tags) => {
    const existing = findMatchingRTag(tags, url);
    if (existing) {
      // if the existing tag is both, change it to an outbox
      if (existing[2] === undefined) return tags.map((t) => (t === existing ? ["r", url, "write"] : t));
      else return tags.filter((t) => t !== existing);
    } else return tags;
  });
}

/** Adds an inbox and outbox relay to NIP-65 */
export function addMailboxRelay(url: string | URL): EventOperation {
  // set replace=true so any existing "read" or "write" tags are overwritten
  return modifyPublicTags(addRelayTag(url, "r", true));
}

/** Completely removes a mailbox relay from NIP-65 */
export function removeMailboxRelay(url: string | URL): EventOperation {
  return modifyPublicTags(removeRelayTag(url, "r"));
}

/** Sets all inbox relays, replacing existing ones while preserving outbox dimension */
export function setInboxRelays(urls: (string | URL)[]): EventOperation {
  const normalizedUrls = urls.map((url) => normalizeURL(url).toString());

  return modifyPublicTags((tags) => {
    // Step 1: Remove all "read" markers from existing relays
    const withoutInboxes = tags
      .map((tag) => {
        if (!isRTag(tag)) return tag;
        // Remove inbox-only relays (read marker)
        if (tag[2] === "read") return null;
        // Convert both (no marker) to outbox-only (write marker)
        if (tag[2] === undefined) return ["r", tag[1], "write"];
        // Keep outbox-only relays (write marker) as is
        return tag;
      })
      .filter((t): t is string[] => t !== null);

    // Step 2: Add "read" markers to the specified URLs
    const result = [...withoutInboxes];
    for (const url of normalizedUrls) {
      const existingIndex = result.findIndex((t) => isRTag(t) && isSameURL(t[1], url));

      if (existingIndex >= 0) {
        const existing = result[existingIndex];
        // Convert outbox-only (write) to both (no marker)
        if (existing[2] === "write") {
          result[existingIndex] = ["r", url];
        }
      } else {
        // Add as inbox-only (read marker)
        result.push(["r", url, "read"]);
      }
    }

    return result;
  });
}

/** Sets all outbox relays, replacing existing ones while preserving inbox dimension */
export function setOutboxRelays(urls: (string | URL)[]): EventOperation {
  const normalizedUrls = urls.map((url) => normalizeURL(url).toString());

  return modifyPublicTags((tags) => {
    // Step 1: Remove all "write" markers from existing relays
    const withoutOutboxes = tags
      .map((tag) => {
        if (!isRTag(tag)) return tag;
        // Remove outbox-only relays (write marker)
        if (tag[2] === "write") return null;
        // Convert both (no marker) to inbox-only (read marker)
        if (tag[2] === undefined) return ["r", tag[1], "read"];
        // Keep inbox-only relays (read marker) as is
        return tag;
      })
      .filter((t): t is string[] => t !== null);

    // Step 2: Add "write" markers to the specified URLs
    const result = [...withoutOutboxes];
    for (const url of normalizedUrls) {
      const existingIndex = result.findIndex((t) => isRTag(t) && isSameURL(t[1], url));

      if (existingIndex >= 0) {
        const existing = result[existingIndex];
        // Convert inbox-only (read) to both (no marker)
        if (existing[2] === "read") {
          result[existingIndex] = ["r", url];
        }
      } else {
        // Add as outbox-only (write marker)
        result.push(["r", url, "write"]);
      }
    }

    return result;
  });
}
