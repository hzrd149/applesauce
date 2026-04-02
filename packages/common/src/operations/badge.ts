import { EventOperation } from "applesauce-core/factories";
import {
  addNameValueTag,
  removeNameValueTag,
  removeSingletonTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { includeSingletonTag, modifyPublicTags } from "applesauce-core/operations/tags";

type ImageDimensions = {
  width?: number;
  height?: number;
};

/** Encodes image dimensions into a string */
function encodeDimensions(dimensions?: ImageDimensions): string | undefined {
  if (!dimensions) return undefined;
  const width = typeof dimensions.width === "number" ? dimensions.width : undefined;
  const height = typeof dimensions.height === "number" ? dimensions.height : undefined;
  if (width === undefined && height === undefined) return undefined;
  if (width !== undefined && height !== undefined) return `${width}x${height}`;
  if (width !== undefined) return `${width}`;
  return `x${height}`;
}

/** Creates an image tag with optional dimensions */
function createImageTag(
  key: "image" | "thumb",
  url: string,
  dimensions?: ImageDimensions,
): [string, string, ...string[]] {
  const size = encodeDimensions(dimensions);
  return size ? [key, url, size] : [key, url];
}

/** Sets or replaces the badge identifier "d" tag */
export function setIdentifier(identifier: string): EventOperation {
  return includeSingletonTag(["d", identifier], true);
}

/** Sets or removes the badge name */
export function setName(name: string | null): EventOperation {
  return modifyPublicTags(name === null ? removeSingletonTag("name") : setSingletonTag(["name", name], true));
}

/** Sets or removes the badge description */
export function setDescription(description: string | null): EventOperation {
  return modifyPublicTags(
    description === null ? removeSingletonTag("description") : setSingletonTag(["description", description], true),
  );
}

/** Sets the hero image metadata */
export function setHeroImage(url: string, dimensions?: ImageDimensions): EventOperation {
  return includeSingletonTag(createImageTag("image", url, dimensions), true);
}

/** Removes the hero image tag */
export function clearHeroImage(): EventOperation {
  return modifyPublicTags(removeSingletonTag("image"));
}

const thumbnailMatcher = (existing: string, incoming: string) => existing === incoming;

/** Adds or replaces a thumbnail entry */
export function addThumbnail(url: string, dimensions?: ImageDimensions): EventOperation {
  return modifyPublicTags(addNameValueTag(createImageTag("thumb", url, dimensions), true, thumbnailMatcher));
}

/** Removes a thumbnail that matches the provided URL */
export function removeThumbnail(url: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["thumb", url]));
}

/** Removes every thumbnail tag */
export function clearThumbnails(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => tag[0] !== "thumb"));
}
