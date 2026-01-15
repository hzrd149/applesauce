import { decode, Ncryptsec, NSec } from "nostr-tools/nip19";
import { decrypt, encrypt } from "nostr-tools/nip49";
import { hexToBytes } from "nostr-tools/utils";
import { isHexKey } from "./string.js";

// Re-export types from nostr-tools
export { generateSecretKey, getPublicKey } from "nostr-tools/pure";

/** Converts hex to nsec strings into Uint8 secret keys */
export function normalizeToSecretKey(str: NSec): Uint8Array;
export function normalizeToSecretKey(str: string | Uint8Array): Uint8Array | null;
export function normalizeToSecretKey(str: string | Uint8Array): Uint8Array | null {
  if (str instanceof Uint8Array) {
    // Ignore invalid lengths
    if (str.length !== 32) return null;

    return str;
  } else if (isHexKey(str)) return hexToBytes(str);
  else {
    try {
      const result = decode(str);
      if (result.type !== "nsec") return null;
      return result.data;
    } catch {
      return null;
    }
  }
}

/** Encrypt a secret key using NIP-49 */
export function encryptSecretKey(key: Uint8Array, password: string): Ncryptsec {
  return encrypt(key, password);
}

/** Decrypt a secret key using NIP-49 */
export function decryptSecretKey(ncryptsec: Ncryptsec | string, password: string): Uint8Array {
  return decrypt(ncryptsec, password);
}
