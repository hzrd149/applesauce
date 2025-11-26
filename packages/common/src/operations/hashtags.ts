import { EventOperation } from "applesauce-core/event-factory";
import { modifyPublicTags } from "applesauce-core/operations";
import { addNameValueTag } from "applesauce-core/operations/tag/common";

/** Adds a hashtag to the live event */
export function addHashtag(hashtag: string): EventOperation {
  // Remove # if present at the beginning
  const cleanTag = (hashtag.startsWith("#") ? hashtag.slice(1) : hashtag).toLocaleLowerCase();
  return modifyPublicTags(addNameValueTag(["t", cleanTag], true));
}

/** Removes a hashtag from the live event */
export function removeHashtag(hashtag: string): EventOperation {
  const cleanTag = (hashtag.startsWith("#") ? hashtag.slice(1) : hashtag).toLocaleLowerCase();
  return modifyPublicTags((tags) => tags.filter((t) => t[0] !== "t" || t[1].toLocaleLowerCase() !== cleanTag));
}

/** Adds "t" tags for an array of hashtags */
export function includeHashtags(hashtags: string[]): EventOperation {
  return modifyPublicTags(...hashtags.map((hashtag) => addNameValueTag(["t", hashtag.toLocaleLowerCase()])));
}
