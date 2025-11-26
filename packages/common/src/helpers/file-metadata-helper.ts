import { FileMetadata } from "./file-metadata.js";
import { NameValueTag } from "applesauce-core/helpers/tags";

/** Creates tags for {@link FileMetadata} */
export function createFileMetadataTags(attachment: FileMetadata): NameValueTag[] {
  const tags: NameValueTag[] = [];

  const add = (name: string, value: string | number) => tags.push([name, String(value)]);
  if (attachment.url) add("url", attachment.url);
  if (attachment.type) add("m", attachment.type);
  if (attachment.sha256) add("x", attachment.sha256);
  if (attachment.originalSha256) add("ox", attachment.originalSha256);
  if (attachment.size !== undefined) add("size", attachment.size);
  if (attachment.dimensions) add("dim", attachment.dimensions);
  if (attachment.magnet) add("magnet", attachment.magnet);
  if (attachment.infohash) add("i", attachment.infohash);
  if (attachment.blurhash) add("blurhash", attachment.blurhash);
  if (attachment.thumbnail) add("thumb", attachment.thumbnail);
  if (attachment.image) add("image", attachment.image);
  if (attachment.summary) add("summary", attachment.summary);
  if (attachment.alt) add("alt", attachment.alt);
  if (attachment.fallback && attachment.fallback?.length > 0)
    for (const url of attachment.fallback) add("fallback", url);

  return tags;
}

/** Creates an imeta tag for a media attachment */
export function createImetaTagForAttachment(attachment: FileMetadata): string[] {
  return ["imeta", ...createFileMetadataTags(attachment).map((t) => t.join(" "))];
}


