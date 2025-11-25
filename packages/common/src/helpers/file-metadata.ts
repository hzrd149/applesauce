import { NostrEvent } from "applesauce-core/helpers/event";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";

export type FileMetadata = {
  /** URL of the file */
  url?: string;
  /** MIME type */
  type?: string;
  /** sha256 hash of the file */
  sha256?: string;
  /**
   * The original sha256 hash before the file was transformed
   * @deprecated
   */
  originalSha256?: string;
  /** size of the file in bytes */
  size?: number;
  /** size of file in pixels in the form <width>x<height> */
  dimensions?: string;
  /** magnet */
  magnet?: string;
  /** torrent infohash */
  infohash?: string;
  /** URL to a thumbnail */
  thumbnail?: string;
  /** URL to a preview image with the same dimensions */
  image?: string;
  /** summary */
  summary?: string;
  /** description for accessability */
  alt?: string;
  /** blurhash */
  blurhash?: string;
  /** fallback URLs */
  fallback?: string[];
};

/** Alias for {@link FileMetadata} */
export type MediaAttachment = FileMetadata;

/**
 * Parses file metadata tags into {@link FileMetadata}
 * @throws
 */
export function parseFileMetadataTags(tags: string[][]): FileMetadata {
  const fields: Record<string, string> = {};
  let fallback: string[] | undefined = undefined;

  for (const [name, value] of tags) {
    switch (name) {
      case "fallback":
        fallback = fallback ? [...fallback, value] : [value];
        break;
      default:
        fields[name] = value;
        break;
    }
  }

  const metadata: FileMetadata = { url: fields.url, fallback };

  // parse size
  if (fields.size) metadata.size = parseInt(fields.size);

  // copy optional fields
  if (fields.m) metadata.type = fields.m;
  if (fields.x) metadata.sha256 = fields.x;
  if (fields.ox) metadata.originalSha256 = fields.ox;
  if (fields.dim) metadata.dimensions = fields.dim;
  if (fields.magnet) metadata.magnet = fields.magnet;
  if (fields.i) metadata.infohash = fields.i;
  if (fields.thumb) metadata.thumbnail = fields.thumb;
  if (fields.image) metadata.image = fields.image;
  if (fields.summary) metadata.summary = fields.summary;
  if (fields.alt) metadata.alt = fields.alt;
  if (fields.blurhash) metadata.blurhash = fields.blurhash;

  return metadata;
}

/** Parses a imeta tag into a {@link FileMetadata} */
export function getFileMetadataFromImetaTag(tag: string[]): FileMetadata {
  const parts = tag.slice(1);
  const tags: string[][] = [];

  for (const part of parts) {
    const match = part.match(/^(.+?)\s(.+)$/);
    if (match) {
      const [_, name, value] = match;

      tags.push([name, value]);
    }
  }

  return parseFileMetadataTags(tags);
}

export const MediaAttachmentsSymbol = Symbol.for("media-attachments");

/** Gets all the media attachments on an event */
export function getMediaAttachments(event: NostrEvent): FileMetadata[] {
  return getOrComputeCachedValue(event, MediaAttachmentsSymbol, () => {
    return event.tags
      .filter((t) => t[0] === "imeta")
      .map((tag) => {
        try {
          return getFileMetadataFromImetaTag(tag);
        } catch (error) {
          // ignore invalid attachments
          return undefined;
        }
      })
      .filter((a) => !!a);
  });
}

/** Gets {@link FileMetadata} for a NIP-94 kind 1063 event */
export function getFileMetadata(file: NostrEvent) {
  return parseFileMetadataTags(file.tags);
}

/** Returns the last 64 length hex string in a URL */
export function getSha256FromURL(url: string | URL): string | undefined {
  if (typeof url === "string") url = new URL(url);

  const hashes = Array.from(url.pathname.matchAll(/[0-9a-f]{64}/gi));
  if (hashes.length > 0) return hashes[hashes.length - 1][0];

  return;
}
