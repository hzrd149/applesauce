import { EventOperation } from "applesauce-core/event-factory";
import { addNameValueTag, removeNameValueTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import {
  createTorrentExternalIdentifier,
  TorrentExternalIdentifier,
  TorrentExternalIdentifierPrefix,
  TorrentFile,
} from "../helpers/torrent.js";

/** Sets the BitTorrent info hash (required `x` tag) */
export function setTorrentInfoHash(infoHash: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["x", infoHash]));
}

/** Sets the torrent title */
export function setTorrentTitle(title: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["title", title]));
}

/** Adds a file entry to the torrent */
export function addTorrentFile(file: TorrentFile): EventOperation {
  const tag: [string, string, ...string[]] = file.size
    ? ["file", file.name, file.size.toString()]
    : ["file", file.name];
  return modifyPublicTags(addNameValueTag(tag, false));
}

/** Removes a file entry from the torrent */
export function removeTorrentFile(fileName: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["file", fileName]));
}

/** Adds a tracker URL to the torrent */
export function addTorrentTracker(tracker: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["tracker", tracker], false));
}

/** Removes a tracker URL from the torrent */
export function removeTorrentTracker(tracker: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["tracker", tracker]));
}

/** Sets the newznab category ID (replaces any existing newznab category) */
export function setTorrentCategory(categoryId: number): EventOperation {
  return modifyPublicTags(setSingletonTag(["i", `newznab:${categoryId}`]));
}

/** Removes the newznab category ID */
export function removeTorrentCategory(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((t) => !(t[0] === "i" && t[1]?.startsWith("newznab:"))));
}

/** Adds a search tag (for searchability) */
export function addTorrentSearchTag(tag: string): EventOperation {
  return modifyPublicTags(addNameValueTag(["t", tag], false));
}

/** Removes a search tag */
export function removeTorrentSearchTag(tag: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["t", tag]));
}

/** Sets the category path (tcat) */
export function setTorrentCategoryPath(categoryPath: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["i", `tcat:${categoryPath}`]));
}

/** Adds an external identifier */
export function addTorrentExternalIdentifier(identifier: TorrentExternalIdentifier): EventOperation {
  return modifyPublicTags(addNameValueTag(["i", identifier.identifier], false));
}

/**
 * Adds an external identifier using prefix, id, and optional mediaType
 * Convenience function that creates the identifier object automatically
 */
export function addTorrentExternalIdentifierByParts(
  prefix: TorrentExternalIdentifierPrefix,
  id: string,
  mediaType?: string,
): EventOperation {
  const identifier = createTorrentExternalIdentifier(prefix, id, mediaType);
  return addTorrentExternalIdentifier(identifier);
}

/** Removes an external identifier */
export function removeTorrentExternalIdentifier(identifier: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["i", identifier]));
}
