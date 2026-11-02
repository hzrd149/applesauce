import { getMessageAttachments, isValidFileMessage } from "applesauce-common/helpers/file-message";
import { createImetaTagForAttachment } from "applesauce-common/helpers/file-metadata";
import { getExpirationTimestamp, type Rumor } from "applesauce-core/helpers";
import type { StoredNdrMessage } from "./history.js";
import type { NdrDeliveryState, NdrSendRequest } from "./types.js";

const CHAT_MESSAGE_KIND = 14;

/**
 * Builds the content and tags of a kind 14 chat rumor, with each attachment URL in the content and described by an imeta tag
 * @throws if the message has no text and no attachments
 */
export function buildNdrChatMessage(request: NdrSendRequest): { content: string; tags: string[][] } {
  const text = request.content.trim();
  const attachments = (request.attachments ?? []).filter((attachment) => !!attachment.url);
  if (!text && attachments.length === 0) throw new Error("Message is empty");

  // Other NDR apps show the links, while imeta tags carry the type and decryption key.
  const content = [text, ...attachments.map((attachment) => attachment.url)].filter(Boolean).join("\n");
  const tags = attachments.map((attachment) => createImetaTagForAttachment(attachment));
  if (request.replyTo) tags.push(["e", request.replyTo]);

  return { content, tags };
}

/** Checks if a rumor is a chat message: a kind 14 message or a NIP-17 kind 15 file message, but never a receipt */
export function isNdrChatRumor(rumor: Rumor): boolean {
  return rumor.kind === CHAT_MESSAGE_KIND || isValidFileMessage(rumor);
}

/** Creates the stored record for a chat rumor */
export function createStoredNdrMessage(
  rumor: Rumor,
  fields: { conversationId: string; sender: string; senderDevice?: string; delivery: NdrDeliveryState },
): StoredNdrMessage {
  const attachments = getMessageAttachments(rumor);

  return {
    ...fields,
    id: rumor.id,
    // A kind 15 message's content is the file URL, which the attachment already describes.
    content: isValidFileMessage(rumor) ? "" : rumor.content,
    createdAt: rumor.created_at,
    replyTo: rumor.tags.find((tag) => tag[0] === "e")?.[1],
    expiresAt: getExpirationTimestamp(rumor),
    attachments: attachments.length ? attachments : undefined,
  };
}
