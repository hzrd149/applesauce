import { EventOperation } from "../types.js";
import { modifyPublicTags } from "./tags.js";
import { addNameValueTag } from "./tag/common.js";

/** Adds "t" tags for an array of hashtags */
export function includeHashtags(hashtags: string[]): EventOperation {
  return modifyPublicTags(...hashtags.map((hashtag) => addNameValueTag(["t", hashtag.toLocaleLowerCase()])));
}
