import { kinds, NostrEvent } from "nostr-tools";
import {
  EncryptedContentSigner,
  getEncryptedContent,
  isEncryptedContentUnlocked,
  lockEncryptedContent,
  UnlockedEncryptedContent,
  unlockEncryptedContent,
} from "applesauce-core/helpers/encrypted-content";
import { getTagValue } from "applesauce-core/helpers/event-tags";
import { KnownEvent } from "applesauce-core/helpers/event";

/** Type for valid legacy direct messages */
export type LegacyMessage = KnownEvent<kinds.EncryptedDirectMessage>;

/** Type for a legacy direct message with unlocked encrypted content */
export type UnlockedLegacyMessage = LegacyMessage & UnlockedEncryptedContent;

/** Checks if a legacy direct message content is encrypted */
export function isLegacyMessageUnlocked<T extends NostrEvent>(event: T): event is T & UnlockedEncryptedContent {
  return isEncryptedContentUnlocked(event);
}

/** Returns the correspondent of a legacy direct message */
export function getLegacyMessageCorrespondent<T extends LegacyMessage>(message: T, self: string): string;
export function getLegacyMessageCorrespondent<T extends NostrEvent>(message: T, self: string): string | undefined;
export function getLegacyMessageCorrespondent<T extends NostrEvent>(message: T, self: string): string | undefined {
  return message.pubkey === self ? getTagValue(message, "p") : message.pubkey;
}

/** Returns the receiver of a legacy direct me */
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

/** Checks if a legacy message is valid */
export function isValidLegacyMessage(event: any): event is LegacyMessage {
  return (
    event.kind === kinds.EncryptedDirectMessage &&
    getLegacyMessageCorrespondent(event, event.pubkey) !== undefined &&
    event.content.length > 0
  );
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

  // Get the correspondent
  const correspondent = getLegacyMessageCorrespondent(message, self);
  if (!correspondent) throw new Error("No correspondent found");

  // Unlock the encrypted content
  return await unlockEncryptedContent(message, correspondent, signer);
}

/** Clears the cached plaintext of a direct message */
export async function lockLegacyMessage(message: NostrEvent) {
  lockEncryptedContent(message);
}
