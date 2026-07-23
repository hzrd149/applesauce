// reexport encryption methods from nostr-tools
// NOTE: import from subpaths only, importing from the "nostr-tools" root pulls in modules that reference `fetch`
export * as nip04 from "nostr-tools/nip04";
export * as nip44 from "nostr-tools/nip44";

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
