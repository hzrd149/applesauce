import { EventOperation, TagOperation } from "applesauce-core/factories";
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
  const tag: [string, string, ...string[]] =
    file.size !== undefined ? ["file", file.name, file.size.toString()] : ["file", file.name];
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

// Replaces the first `i` tag with the given prefix and removes the rest, leaving other `i` tags untouched
function setPrefixedIdentifierTag(prefix: string, value: string): TagOperation {
  return (tags) => {
    const tag = ["i", `${prefix}:${value}`];
    const index = tags.findIndex((t) => t[0] === "i" && t[1]?.startsWith(`${prefix}:`));
    if (index === -1) return [...tags, tag];

    return tags.flatMap((t, i) => {
      if (i === index) return [tag];
      return t[0] === "i" && t[1]?.startsWith(`${prefix}:`) ? [] : [t];
    });
  };
}

// Removes every `i` tag with the given prefix
function removePrefixedIdentifierTags(prefix: string): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === "i" && t[1]?.startsWith(`${prefix}:`)));
}

/** Sets the newznab category ID (replaces any existing newznab category) */
export function setTorrentCategory(categoryId: number): EventOperation {
  return modifyPublicTags(setPrefixedIdentifierTag("newznab", String(categoryId)));
}

/** Removes the newznab category ID */
export function removeTorrentCategory(): EventOperation {
  return modifyPublicTags(removePrefixedIdentifierTags("newznab"));
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
  return modifyPublicTags(setPrefixedIdentifierTag("tcat", categoryPath));
}

/** Removes the category path (tcat) */
export function removeTorrentCategoryPath(): EventOperation {
  return modifyPublicTags(removePrefixedIdentifierTags("tcat"));
}

/** Adds an external identifier */
export function addTorrentExternalIdentifier(identifier: TorrentExternalIdentifier): EventOperation {
  return modifyPublicTags(addNameValueTag(["i", identifier.identifier], false));
}

/** Adds an external identifier built from a prefix, id, and optional media type */
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
