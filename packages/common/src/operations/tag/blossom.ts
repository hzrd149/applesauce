import { areBlossomServersEqual } from "../../helpers/blossom.js";
import { addNameValueTag } from "applesauce-core/factory-operations/tag/common.js";
import { TagOperation } from "applesauce-core/factory-types.js";

/** Adds a server tag to a 10063 event */
export function addBlossomServerTag(url: string | URL, replace = true): TagOperation {
  url = new URL("/", url).toString();
  return addNameValueTag(["server", url], replace, (a, b) => areBlossomServersEqual(a, b));
}

/** Removes all server tags matching the url from a 10063 event */
export function removeBlossomServerTag(url: string | URL): TagOperation {
  url = new URL("/", url);
  return (tags) => tags.filter((t) => !(t[0] === "server" && t[1] && areBlossomServersEqual(t[1], url)));
}
