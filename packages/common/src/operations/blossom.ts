import { EventOperation } from "applesauce-core/event-factory";
import { normalizeURL } from "applesauce-core/helpers";
import { addNameValueTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { areBlossomServersEqual } from "../helpers/blossom.js";

/** Adds a server to a 10063 event */
export function addServer(url: string | URL, replace = true): EventOperation {
  url = normalizeURL(url).toString();
  return modifyPublicTags(addNameValueTag(["server", url], replace, (a, b) => areBlossomServersEqual(a, b)));
}

/** Removes server matching the url from a 10063 event */
export function removeServer(url: string | URL): EventOperation {
  return modifyPublicTags((tags) =>
    tags.filter((t) => !(t[0] === "server" && t[1] && areBlossomServersEqual(t[1], url))),
  );
}
