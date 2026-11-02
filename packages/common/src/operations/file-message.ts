import { EventOperation } from "applesauce-core/factories";
import { eventPipe } from "applesauce-core/helpers/pipeline";
import { setContent } from "applesauce-core/operations/content";
import { addNameValueTag, removeSingletonTag, setSingletonTag } from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { FileMetadataFields } from "../helpers/file-metadata.js";

/** The kind 15 tags written for each file field, in NIP-17 order */
const FILE_MESSAGE_TAGS: [string, keyof FileMetadataFields][] = [
  ["file-type", "type"],
  ["encryption-algorithm", "encryptionAlgorithm"],
  ["decryption-key", "decryptionKey"],
  ["decryption-nonce", "decryptionNonce"],
  ["x", "sha256"],
  ["ox", "originalSha256"],
  ["size", "size"],
  ["dim", "dimensions"],
  ["blurhash", "blurhash"],
  ["thumb", "thumbnail"],
  ["alt", "alt"],
];

/**
 * Sets the URL and file tags of a NIP-17 kind 15 file message
 * @throws if the file has no URL
 */
export function setFileMessage(file: FileMetadataFields): EventOperation {
  if (!file.url) throw new Error("File message requires a URL");

  const tagOperations = FILE_MESSAGE_TAGS.map(([name, field]) => {
    const value = file[field];
    if (value === undefined || value === "") return removeSingletonTag(name);
    return setSingletonTag([name, String(value)], true);
  });
  const fallbackOperations = (file.fallback ?? []).map((url) => addNameValueTag(["fallback", url]));

  return eventPipe(setContent(file.url), modifyPublicTags(...tagOperations, ...fallbackOperations));
}
