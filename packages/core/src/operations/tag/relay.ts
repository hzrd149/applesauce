import type { TagOperation } from "../../factories/types.js";
import { isSameURL, normalizeURL } from "../../helpers/url.js";
import { addNameValueTag } from "./common.js";

/** Adds a relay tag */
export function addRelayTag(url: string | URL, tagName = "relay", replace = true): TagOperation {
  return addNameValueTag([tagName, normalizeURL(url).toString()], replace, (a, b) => isSameURL(a, b));
}

/** Removes all relay tags matching the relay */
export function removeRelayTag(url: string | URL, tagName = "relay"): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tagName && t[1] && isSameURL(t[1], url)));
}
