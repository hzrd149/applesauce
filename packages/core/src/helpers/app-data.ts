import { NostrEvent } from "nostr-tools";
import { EncryptionMethod } from "./encrypted-content.js";
import { isNIP04Encrypted } from "./encryption.js";
import {
  getHiddenContent,
  HiddenContentSigner,
  isHiddenContentLocked,
  lockHiddenContent,
  setHiddenContentEncryptionMethod,
  unlockHiddenContent,
} from "./hidden-content.js";
import { safeParse } from "./json.js";

// NIP-78 Application Data event kind
export const APP_DATA_KIND = 30078;

export const AppDataContentSymbol = Symbol.for("app-data-content");

// Set the encryption method for app data events (default to nip44)
setHiddenContentEncryptionMethod(APP_DATA_KIND, "nip44");

/** Checks if an event has application data */
export function hasAppData<T extends { kind: number; content: string }>(event: T): boolean {
  return event.kind === APP_DATA_KIND && event.content.length > 0;
}

/** Checks if the application data is encrypted */
export function getAppDataEncryption<T extends { kind: number; content: string }>(
  event: T,
): EncryptionMethod | undefined {
  // If content is empty, it can't be encrypted
  if (event.content.length === 0) return undefined;

  // Try to parse as JSON - if it fails, it's likely encrypted
  const parsed = safeParse(event.content);
  if (parsed !== undefined) return undefined;

  return isNIP04Encrypted(event.content) ? "nip04" : "nip44";
}

/** Checks if the application data is locked (encrypted and not decrypted) */
export function isAppDataLocked<T extends object>(event: T): boolean {
  return isHiddenContentLocked(event);
}

/** Returns the parsed application data for an event if it's unlocked */
export function getAppDataContent<
  R extends unknown = unknown,
  T extends { kind: number; content: string } = NostrEvent,
>(event: T): R | undefined {
  const cached = Reflect.get(event, AppDataContentSymbol) as R | undefined;
  if (cached) return cached;

  // If content is empty, return undefined
  if (event.content.length === 0) return undefined;

  let data = getAppDataEncryption(event) ? undefined : (safeParse(event.content) as R);
  if (!data) {
    const decrypted = getHiddenContent(event);
    if (decrypted) data = safeParse<R>(decrypted);
  }
  if (!data) return undefined;

  Reflect.set(event, AppDataContentSymbol, data);
  return data;
}

/**
 * Unlocks the encrypted application data in the event
 * @param event The event with encrypted content to decrypt
 * @param signer A signer to use to decrypt the content
 * @param override The encryption method to use instead of the default
 * @returns The decrypted application data
 */
export async function unlockAppData<
  R extends unknown = unknown,
  T extends { kind: number; pubkey: string; content: string } = NostrEvent,
>(event: T, signer: HiddenContentSigner, override?: EncryptionMethod): Promise<R> {
  if (!getAppDataEncryption(event)) return getAppDataContent(event) as R;

  const method = override ?? getAppDataEncryption(event);
  const plaintext = await unlockHiddenContent(event, signer, method);
  const parsed = safeParse<R>(plaintext);

  if (parsed === undefined) throw new Error("Failed to parse decrypted application data as JSON");

  return parsed;
}

/** Removes the unencrypted application data cache on an event */
export function lockAppData<T extends object>(event: T): void {
  lockHiddenContent(event);
}
