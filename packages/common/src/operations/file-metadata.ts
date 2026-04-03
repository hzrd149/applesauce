import { EventOperation } from "applesauce-core/factories";
import { eventPipe } from "applesauce-core/helpers";
import {
  addNameValueTag,
  removeNameValueTag,
  removeSingletonTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { FileMetadataFields } from "../helpers/file-metadata.js";

function setNullableSingletonTag(name: string, value: string | number | null): EventOperation {
  return modifyPublicTags(value === null ? removeSingletonTag(name) : setSingletonTag([name, String(value)], true));
}

/** Sets or removes the file URL */
export function setFileURL(url: string | null): EventOperation {
  return setNullableSingletonTag("url", url);
}

/** Sets or removes the file MIME type */
export function setFileType(type: string | null): EventOperation {
  return setNullableSingletonTag("m", type);
}

/** Sets or removes the file SHA-256 hash */
export function setFileSHA256(hash: string | null): EventOperation {
  return setNullableSingletonTag("x", hash);
}

/** Sets or removes the original file SHA-256 hash */
export function setOriginalFileSHA256(hash: string | null): EventOperation {
  return setNullableSingletonTag("ox", hash);
}

/** Sets or removes the file size */
export function setFileSize(size: number | null): EventOperation {
  return setNullableSingletonTag("size", size);
}

/** Sets or removes the file dimensions */
export function setFileDimensions(dimensions: string | null): EventOperation {
  return setNullableSingletonTag("dim", dimensions);
}

/** Sets or removes the magnet URI */
export function setFileMagnet(magnet: string | null): EventOperation {
  return setNullableSingletonTag("magnet", magnet);
}

/** Sets or removes the torrent infohash */
export function setFileInfohash(infohash: string | null): EventOperation {
  return setNullableSingletonTag("i", infohash);
}

/** Sets or removes the thumbnail URL */
export function setFileThumbnail(url: string | null): EventOperation {
  return setNullableSingletonTag("thumb", url);
}

/** Sets or removes the preview image URL */
export function setFileImage(url: string | null): EventOperation {
  return setNullableSingletonTag("image", url);
}

/** Sets or removes the summary */
export function setFileSummary(summary: string | null): EventOperation {
  return setNullableSingletonTag("summary", summary);
}

/** Sets or removes the alt text */
export function setFileAlt(alt: string | null): EventOperation {
  return setNullableSingletonTag("alt", alt);
}

/** Sets or removes the blurhash */
export function setFileBlurhash(blurhash: string | null): EventOperation {
  return setNullableSingletonTag("blurhash", blurhash);
}

/** Adds a fallback URL */
export function addFallbackURL(url: string, replace = true): EventOperation {
  return modifyPublicTags(addNameValueTag(["fallback", url], replace));
}

/** Removes a matching fallback URL */
export function removeFallbackURL(url: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["fallback", url]));
}

/** Removes all fallback URLs */
export function clearFallbackURLs(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => tag[0] !== "fallback"));
}

/** Replaces all fallback URLs with the provided list */
export function setFallbackURLs(urls: string[]): EventOperation {
  return eventPipe(clearFallbackURLs(), ...urls.map((url) => addFallbackURL(url, false)));
}

/** Sets all NIP-94 tags for {@link FileMetadataFields} */
export function setFileMetadata(metadata: FileMetadataFields): EventOperation {
  const operations: EventOperation[] = [];

  if ("url" in metadata) operations.push(setFileURL(metadata.url ?? null));
  if ("type" in metadata) operations.push(setFileType(metadata.type ?? null));
  if ("sha256" in metadata) operations.push(setFileSHA256(metadata.sha256 ?? null));
  if ("originalSha256" in metadata) operations.push(setOriginalFileSHA256(metadata.originalSha256 ?? null));
  if ("size" in metadata) operations.push(setFileSize(metadata.size ?? null));
  if ("dimensions" in metadata) operations.push(setFileDimensions(metadata.dimensions ?? null));
  if ("magnet" in metadata) operations.push(setFileMagnet(metadata.magnet ?? null));
  if ("infohash" in metadata) operations.push(setFileInfohash(metadata.infohash ?? null));
  if ("thumbnail" in metadata) operations.push(setFileThumbnail(metadata.thumbnail ?? null));
  if ("image" in metadata) operations.push(setFileImage(metadata.image ?? null));
  if ("summary" in metadata) operations.push(setFileSummary(metadata.summary ?? null));
  if ("alt" in metadata) operations.push(setFileAlt(metadata.alt ?? null));
  if ("blurhash" in metadata) operations.push(setFileBlurhash(metadata.blurhash ?? null));
  if ("fallback" in metadata) operations.push(setFallbackURLs(metadata.fallback ?? []));

  return eventPipe(...operations);
}
