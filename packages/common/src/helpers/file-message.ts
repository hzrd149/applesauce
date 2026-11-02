import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { kinds, NostrEvent, Rumor } from "applesauce-core/helpers/event";
import { FileMetadataFields, getMediaAttachments, parseFileMetadataTags } from "./file-metadata.js";

/** The NIP-17 file message kind */
export const FILE_MESSAGE_KIND = kinds.FileMessage;

/** A NIP-17 kind 15 file message rumor */
export type FileMessage = Rumor & { kind: typeof FILE_MESSAGE_KIND };

const FileMessageMetadataSymbol = Symbol.for("file-message-metadata");
const MessageAttachmentsSymbol = Symbol.for("message-attachments");

function isURL(content: string): boolean {
  try {
    const url = new URL(content.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Checks if a rumor is a valid NIP-17 kind 15 file message
 * @note requires a file-type or decryption-key tag, which also tells a file apart from a double-ratchet kind 15 receipt
 */
export function isValidFileMessage(rumor?: Rumor | NostrEvent): rumor is FileMessage {
  if (!rumor || rumor.kind !== FILE_MESSAGE_KIND || !isURL(rumor.content)) return false;
  return rumor.tags.some((tag) => (tag[0] === "file-type" || tag[0] === "decryption-key") && !!tag[1]);
}

/** Gets the file URL, type, hashes, and decryption fields of a kind 15 file message */
export function getFileMessageMetadata(message: FileMessage): FileMetadataFields;
export function getFileMessageMetadata(message?: Rumor | NostrEvent): FileMetadataFields | undefined;
export function getFileMessageMetadata(message?: Rumor | NostrEvent): FileMetadataFields | undefined {
  if (!isValidFileMessage(message)) return undefined;

  return getOrComputeCachedValue(message, FileMessageMetadataSymbol, () => {
    // Kind 15 names the MIME type "file-type" where NIP-94 uses "m".
    const tags = message.tags.map((tag) => (tag[0] === "file-type" ? ["m", tag[1]] : tag));
    return { ...parseFileMetadataTags(tags), url: message.content.trim() };
  });
}

/** Gets the attachments of a message, from a kind 15 file message or the imeta tags of any other message */
export function getMessageAttachments(message: Rumor | NostrEvent): FileMetadataFields[] {
  return getOrComputeCachedValue(message, MessageAttachmentsSymbol, () => {
    if (message.kind === FILE_MESSAGE_KIND) {
      const file = getFileMessageMetadata(message);
      return file ? [file] : [];
    }

    return getMediaAttachments(message as NostrEvent).filter((attachment) => !!attachment.url);
  });
}
