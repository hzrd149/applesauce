// reexport encryption methods from nostr-tools
// NOTE: import from subpaths only, importing from the "nostr-tools" root pulls in modules that reference `fetch`
export * as nip04 from "nostr-tools/nip04";
export * as nip44 from "nostr-tools/nip44";

import { getConversationKey as computeConversationKey } from "nostr-tools/nip44";
import { LRU } from "./lru.js";

// Cached per secret key so replacing or dropping a key also drops its conversation keys
const conversationKeys = new WeakMap<Uint8Array, LRU<Uint8Array>>();

/** Gets the NIP-44 conversation key between a secret key and a pubkey, caching the ECDH result per pair */
export function getCachedConversationKey(key: Uint8Array, pubkey: string): Uint8Array {
  let keys = conversationKeys.get(key);
  if (!keys) conversationKeys.set(key, (keys = new LRU<Uint8Array>(1000)));

  let conversationKey = keys.get(pubkey);
  if (!conversationKey) keys.set(pubkey, (conversationKey = computeConversationKey(key, pubkey)));
  return conversationKey;
}

/**
 * Checks if a string is encrypted with NIP-04 or NIP-44
 * @see https://github.com/nostr-protocol/nips/pull/1248#issuecomment-2437731316
 */
export function isNIP04Encrypted(ciphertext: string): boolean {
  const l = ciphertext.length;
  if (l < 28) return false;
  return (
    ciphertext[l - 28] == "?" && ciphertext[l - 27] == "i" && ciphertext[l - 26] == "v" && ciphertext[l - 25] == "="
  );
}
