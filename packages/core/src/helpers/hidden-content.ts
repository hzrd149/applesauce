import { kinds } from "nostr-tools";
import {
  canHaveEncryptedContent,
  EncryptedContentSigner,
  EncryptedContentSymbol,
  EncryptionMethod,
  getEncryptedContent,
  getEncryptedContentEncryptionMethods,
  hasEncryptedContent,
  isEncryptedContentLocked,
  lockEncryptedContent,
  setEncryptedContentCache,
  setEncryptedContentEncryptionMethod,
} from "./encrypted-content.js";

// reexport from encrypted-content
export const HiddenContentSymbol = EncryptedContentSymbol;
export interface HiddenContentSigner extends EncryptedContentSigner {}
export const getHiddenContentEncryptionMethods = getEncryptedContentEncryptionMethods;

/** Various event kinds that can have hidden content */
export const HiddenContentKinds = new Set<number>([setEncryptedContentEncryptionMethod(kinds.DraftLong, "nip04")]);

/** Sets the encryption method for hidden content on a kind */
export function setHiddenContentEncryptionMethod(kind: number, method: EncryptionMethod) {
  HiddenContentKinds.add(setEncryptedContentEncryptionMethod(kind, method));
  return kind;
}

/** Checks if an event can have hidden content */
export function canHaveHiddenContent(kind: number): boolean {
  return canHaveEncryptedContent(kind) && HiddenContentKinds.has(kind);
}

/** Checks if an event has hidden content */
export function hasHiddenContent<T extends { kind: number; content: string }>(event: T): boolean {
  return canHaveHiddenContent(event.kind) && hasEncryptedContent(event);
}

/** Checks if the hidden content is locked */
export function isHiddenContentLocked<T extends object>(event: T): boolean {
  return isEncryptedContentLocked(event);
}

/** Returns the hidden content for an event if they are unlocked */
export function getHiddenContent<T extends { kind: number; content: string }>(event: T): string | undefined {
  if (!canHaveHiddenContent(event.kind) || isHiddenContentLocked(event)) return undefined;
  return getEncryptedContent(event);
}

/**
 * Unlocks the hidden content in the event
 * @param event The event with content to decrypt
 * @param signer A signer to use to decrypt the content
 * @throws
 */
export async function unlockHiddenContent<T extends { kind: number; pubkey: string; content: string }>(
  event: T,
  signer: EncryptedContentSigner,
  override?: EncryptionMethod,
): Promise<string> {
  if (!canHaveHiddenContent(event.kind)) throw new Error("Event kind does not support hidden content");
  const encryption = getEncryptedContentEncryptionMethods(event.kind, signer, override);
  const plaintext = await encryption.decrypt(event.pubkey, event.content);

  setHiddenContentCache(event, plaintext);
  return plaintext;
}

/**
 * Sets the hidden content on an event and updates it if its part of an event store
 * @throws
 */
export function setHiddenContentCache<T extends { kind: number }>(event: T, plaintext: string) {
  if (!canHaveHiddenContent(event.kind)) throw new Error("Event kind does not support hidden content");

  // Set the encrypted content
  setEncryptedContentCache(event, plaintext);
}

/** Removes the unencrypted hidden content on an event */
export function lockHiddenContent<T extends object>(event: T) {
  lockEncryptedContent(event);
}
