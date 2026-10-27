import { setCachedValue } from "./cache.js";
import { getEncryptedContent, setEncryptedContentCache } from "./encrypted-content.js";
import { NostrEvent } from "./event.js";

/** A symbol that is used to mark encrypted content as being from a cache */
export const EncryptedContentFromCacheSymbol = Symbol.for("encrypted-content-from-cache");

/** An interface that is used to cache encrypted content on events */
export interface EncryptedContentCache {
  /** Reads plaintext by event ID, returning null on a cache miss */
  getItem: (key: string) => string | null | Promise<string | null>;
  /** Stores plaintext by event ID */
  setItem: (key: string, value: string) => void | Promise<any>;
}

/** Marks the encrypted content as being from a cache */
export function markEncryptedContentFromCache<T extends object>(event: T) {
  // Keep restore provenance instance-local so copied events do not inherit a stale cache flag.
  setCachedValue(event, EncryptedContentFromCacheSymbol, true);
}

/** Checks if the encrypted content is from a cache */
export function isEncryptedContentFromCache<T extends object>(event: T): boolean {
  return Reflect.has(event, EncryptedContentFromCacheSymbol);
}

/**
 * Restores plaintext by event ID and marks it as cached before notifying observers
 * @returns The restored or already unlocked plaintext, or undefined on a cache miss
 * @throws If reading from storage fails
 */
export async function restoreEncryptedContent(
  event: NostrEvent,
  storage: EncryptedContentCache,
): Promise<string | undefined> {
  const unlockedContent = getEncryptedContent(event);
  if (unlockedContent !== undefined) return unlockedContent;

  const cachedContent = await storage.getItem(event.id);

  // A signer may have unlocked the event while storage was being read.
  const currentContent = getEncryptedContent(event);
  if (currentContent !== undefined) return currentContent;
  if (typeof cachedContent !== "string") return undefined;

  markEncryptedContentFromCache(event);
  setEncryptedContentCache(event, cachedContent);

  return cachedContent;
}

/**
 * Saves an event's unlocked plaintext under its event ID, including empty plaintext
 * @returns Whether the event had plaintext to save
 * @throws If writing to storage fails
 */
export async function saveEncryptedContent(event: NostrEvent, storage: EncryptedContentCache): Promise<boolean> {
  const plaintext = getEncryptedContent(event);
  if (plaintext === undefined) return false;

  await storage.setItem(event.id, plaintext);
  return true;
}

/**
 * Returns unlocked or stored plaintext, otherwise decrypts and saves it by event ID
 * @throws If reading, decrypting, or writing fails
 */
export async function getOrDecryptEncryptedContent(
  event: NostrEvent,
  storage: EncryptedContentCache,
  decrypt: (event: NostrEvent) => string | Promise<string>,
): Promise<string> {
  const cachedContent = await restoreEncryptedContent(event, storage);
  if (cachedContent !== undefined) return cachedContent;

  const plaintext = await decrypt(event);

  Reflect.deleteProperty(event, EncryptedContentFromCacheSymbol);
  setEncryptedContentCache(event, plaintext);
  await storage.setItem(event.id, plaintext);

  return plaintext;
}
