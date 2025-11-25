import { areBlossomServersEqual } from "applesauce-common/helpers/blossom";
import { addNameValueTag } from "./common.js";
import { TagOperation } from "../../types.js";

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
