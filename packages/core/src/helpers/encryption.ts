// reexport encryption methods from nostr-tools
export { nip04, nip44 } from "nostr-tools";

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
