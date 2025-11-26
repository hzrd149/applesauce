import { EventOperation, TagOperation } from "../event-factory/types.js";
import { isRTag } from "../helpers/tags.js";
import { isSameURL, normalizeURL } from "../helpers/url.js";
import { addNameValueTag } from "./tag/common.js";
import { modifyPublicTags } from "./tags.js";

/** Adds a relay tag */
function addRelayTag(url: string | URL, tagName = "relay", replace = true): TagOperation {
  return addNameValueTag([tagName, normalizeURL(url).toString()], replace, (a, b) => isSameURL(a, b));
}

/** Removes all relay tags matching the relay */
function removeRelayTag(url: string | URL, tagName = "relay"): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tagName && t[1] && isSameURL(t[1], url)));
}

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
