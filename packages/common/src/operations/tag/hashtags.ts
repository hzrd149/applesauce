import { TagOperation } from "applesauce-core/factory-types.js";
import { addNameValueTag } from "applesauce-core/factory-operations/tag/common.js";

/** Adds a hashtag to the live event */
export function addHashtag(hashtag: string): TagOperation {
  // Remove # if present at the beginning
  const cleanTag = (hashtag.startsWith("#") ? hashtag.slice(1) : hashtag).toLocaleLowerCase();
  return addNameValueTag(["t", cleanTag], true);
}

/** Removes a hashtag from the live event */
export function removeHashtag(hashtag: string): TagOperation {
  const cleanTag = (hashtag.startsWith("#") ? hashtag.slice(1) : hashtag).toLocaleLowerCase();
  return (tags) => tags.filter((t) => t[0] !== "t" || t[1].toLocaleLowerCase() !== cleanTag);
}


