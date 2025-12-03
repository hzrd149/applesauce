import { decode, Ncryptsec } from "nostr-tools/nip19";
import { hexToBytes } from "nostr-tools/utils";
import { isHexKey } from "./string.js";
import { encrypt, decrypt } from "nostr-tools/nip49";

// Re-export types from nostr-tools
export { generateSecretKey, getPublicKey } from "nostr-tools/pure";

/** Converts hex to nsec strings into Uint8 secret keys */
export function normalizeToSecretKey(str: string | Uint8Array): Uint8Array {
  if (str instanceof Uint8Array) return str;
  else if (isHexKey(str)) return hexToBytes(str);
  else {
    const result = decode(str);
    if (result.type !== "nsec") throw new Error(`Cant get secret key from ${result.type}`);
    return result.data;
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
