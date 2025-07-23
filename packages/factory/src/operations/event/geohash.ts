import { EventOperation } from "../../types.js";
import { modifyPublicTags } from "./tags.js";

/** Adds all "g" geohash tags for a given geohash */
export function setGeohashTags(geohash: string): EventOperation {
  return modifyPublicTags((tags) => {
    tags = tags.filter((t) => t[0] !== "g" && t[1]);

    for (let i = 0; i < geohash.length; i++) {
      tags.push(["g", geohash.slice(0, i + 1)]);
    }

    return tags;
  });
}

/** Removes all "g" geohash tags from an event */
export function removeGeohashTags(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((t) => t[0] !== "g" && t[1]));
}
