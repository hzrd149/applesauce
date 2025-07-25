import { EventOperation } from "../types.js";
import { TagOperations } from "./index.js";
import { modifyPublicTags } from "./tags.js";

/** Adds a server to a 10063 event */
export function addServer(url: string | URL, replace = true): EventOperation {
  return modifyPublicTags(TagOperations.addBlossomServerTag(url, replace));
}

/** Removes server matching the url from a 10063 event */
export function removeServer(url: string | URL): EventOperation {
  return modifyPublicTags(TagOperations.removeBlossomServerTag(url));
}
