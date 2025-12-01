import { decode } from "nostr-tools/nip19";
import { hexToBytes } from "nostr-tools/utils";
import { isHexKey } from "./string.js";

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
