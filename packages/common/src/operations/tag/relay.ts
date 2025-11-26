import { isSameURL, normalizeURL } from "applesauce-core/helpers";
import { addNameValueTag } from "applesauce-core/factory-operations/tag/common.js";
import { TagOperation } from "applesauce-core/factory-types.js";

/** Adds a relay tag */
export function addRelayTag(url: string | URL, tagName = "relay", replace = true): TagOperation {
  url = normalizeURL(url).toString();

  return addNameValueTag([tagName, url], replace, (a, b) => isSameURL(a, b));
}

/** Removes all relay tags matching the relay */
export function removeRelayTag(url: string | URL, tagName = "relay"): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tagName && t[1] && isSameURL(t[1], url)));
}


