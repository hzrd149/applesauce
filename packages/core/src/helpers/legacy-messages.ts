import { NostrEvent } from "nostr-tools";
import {
  EncryptedContentSigner,
  getEncryptedContent,
  isEncryptedContentLocked,
  lockEncryptedContent,
  unlockEncryptedContent,
} from "./encrypted-content.js";
import { getTagValue } from "./index.js";

/** Checks if a legacy direct message content is encrypted */
export function isLegacyMessageLocked(event: NostrEvent): boolean {
  return isEncryptedContentLocked(event);
}

/**
 * Returns the correspondent of a legacy direct message
 * @throws if no correspondent is found
 */
export function getLegacyMessageCorrespondent(message: NostrEvent, self: string): string {
  const correspondent = message.pubkey === self ? getTagValue(message, "p") : message.pubkey;
  if (!correspondent) throw new Error("No correspondent found");
  return correspondent;
}

/**
 * Returns the receiver of a legacy direct message
 * @throws if no receiver is found
 */
export const getLegacyMessageReceiver = getLegacyMessageCorrespondent;

/** @deprecated use {@link getLegacyMessageCorrespondent} instead */
export const getLegacyMessageCorraspondant = getLegacyMessageCorrespondent;

/** Returns the sender of a legacy direct message */
export function getLegacyMessageSender(message: NostrEvent): string {
  return message.pubkey;
}

/** Returns the parent message id of a legacy message */
export function getLegacyMessageParent(message: NostrEvent): string | undefined {
  return getTagValue(message, "e");
}

/**
 * Returns the decrypted content of a direct message
 * @param message - The message to decrypt
 * @param self - The public key of the user
 * @param signer - The signer to use to decrypt the message
 * @returns The decrypted content of the message
 */
export async function unlockLegacyMessage(
  message: NostrEvent,
  self: string,
  signer: EncryptedContentSigner,
): Promise<string> {
  const cached = getEncryptedContent(message);
  if (cached) return cached;

  const correspondent = getLegacyMessageCorrespondent(message, self);

  // Unlock the encrypted content
  return await unlockEncryptedContent(message, correspondent, signer);
}

/** Clears the cached plaintext of a direct message */
export async function lockLegacyMessage(message: NostrEvent) {
  lockEncryptedContent(message);
}
