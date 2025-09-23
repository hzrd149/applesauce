import { kinds } from "nostr-tools";
import { notifyEventUpdate } from "./event.js";

/** A symbol use to store the encrypted content of an event in memory */
export const EncryptedContentSymbol = Symbol.for("encrypted-content");

export interface EncryptedContentSigner {
  nip04?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
  };
  nip44?: {
    encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
    decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
  };
}

/** Encryption method types */
export type EncryptionMethod = "nip04" | "nip44";

/** Type for an event who's encrypted content is unlocked */
export type UnlockedEncryptedContent = {
  [EncryptedContentSymbol]: string;
};

/** A pair of encryption methods for encrypting and decrypting event content */
export interface EncryptionMethods {
  encrypt: (pubkey: string, plaintext: string) => Promise<string> | string;
  decrypt: (pubkey: string, ciphertext: string) => Promise<string> | string;
}

/** Various event kinds that can have encrypted content and which encryption method they use */
export const EventContentEncryptionMethod: Record<number, EncryptionMethod> = {
  [kinds.EncryptedDirectMessage]: "nip04",
  [kinds.Seal]: "nip44",
  [kinds.GiftWrap]: "nip44",
};

/** Sets the encryption method that is used for the contents of a specific event kind */
export function setEncryptedContentEncryptionMethod(kind: number, method: EncryptionMethod): number {
  EventContentEncryptionMethod[kind] = method;
  return kind;
}

/**
 * Returns either nip04 or nip44 encryption methods depending on event kind
 * @param kind The event kind to get the encryption method for
 * @param signer The signer to use to get the encryption methods
 * @param override The encryption method to use instead of the default
 * @throws If the event kind does not support encrypted content
 * @throws If the signer does not support the encryption method
 * @returns The encryption methods for the event kind
 */
export function getEncryptedContentEncryptionMethods(
  kind: number,
  signer: EncryptedContentSigner,
  override?: EncryptionMethod,
): EncryptionMethods {
  const method = override ?? EventContentEncryptionMethod[kind];
  if (!method) throw new Error(`Event kind ${kind} does not support encrypted content`);
  const encryption = signer[method];
  if (!encryption) throw new Error(`Signer does not support ${method} encryption`);

  return encryption;
}

/** Checks if an event can have encrypted content */
export function canHaveEncryptedContent(kind: number): boolean {
  return EventContentEncryptionMethod[kind] !== undefined;
}

/** Checks if an event has encrypted content */
export function hasEncryptedContent<T extends { content: string }>(event: T): boolean {
  return event.content.length > 0;
}

/** Returns the encrypted content for an event if it is unlocked */
export function getEncryptedContent<T extends UnlockedEncryptedContent>(event: T): string;
export function getEncryptedContent<T extends object>(event: T): string | undefined;
export function getEncryptedContent<T extends object>(event: T): string | undefined {
  return Reflect.get(event, EncryptedContentSymbol) as string | undefined;
}

/** Checks if the encrypted content is unlocked and casts it to the {@link UnlockedEncryptedContent} type */
export function isEncryptedContentUnlocked<T extends object>(event: T): event is T & UnlockedEncryptedContent {
  return Reflect.has(event, EncryptedContentSymbol) === true;
}

/**
 * Unlocks the encrypted content in an event and caches it
 * @param event The event with content to decrypt
 * @param pubkey The other pubkey that encrypted the content
 * @param signer A signer to use to decrypt the content
 * @throws If the event kind does not support encrypted content
 */
export async function unlockEncryptedContent<T extends { kind: number; content: string }>(
  event: T,
  pubkey: string,
  signer: EncryptedContentSigner,
): Promise<string> {
  if (!canHaveEncryptedContent(event.kind)) throw new Error("Event kind does not support encrypted content");

  // Get the encryption methods from the signer
  const encryption = getEncryptedContentEncryptionMethods(event.kind, signer);
  const plaintext = await encryption.decrypt(pubkey, event.content);

  // Set the cached value and trigger update
  setEncryptedContentCache(event, plaintext);

  // Return the decrypted content
  return plaintext;
}

/** Sets the encrypted content on an event and updates it if its part of an event store */
export function setEncryptedContentCache<T extends object>(event: T, plaintext: string) {
  Reflect.set(event, EncryptedContentSymbol, plaintext);

  // if the event has been added to an event store, notify it
  notifyEventUpdate(event);
}

/** Removes the encrypted content cache on an event */
export function lockEncryptedContent<T extends object>(event: T) {
  Reflect.deleteProperty(event, EncryptedContentSymbol);

  // if the event has been added to an event store, notify it
  notifyEventUpdate(event);
}
