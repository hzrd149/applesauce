import { Proof } from "@cashu/cashu-ts";
import { getOrComputeCachedValue, mergeRelaySets, safeParse } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";

export const NUTZAP_INFO_KIND = 10019;

// Symbols for caching computed values
export const NutzapMintsSymbol = Symbol.for("nutzap-mints");
export const NutzapRelaysSymbol = Symbol.for("nutzap-relays");

/** Returns the relay URLs from a kind:10019 nutzap info event */
export function getNutzapInfoRelays(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NutzapRelaysSymbol, () => {
    return mergeRelaySets(event.tags.filter((t) => t[0] === "relay").map((t) => t[1]));
  });
}

/** Returns the mint URLs from a kind:10019 nutzap info event */
export function getNutzapInfoMints(event: NostrEvent): { mint: string; units?: string[] }[] {
  return getOrComputeCachedValue(event, NutzapMintsSymbol, () => {
    return event.tags.filter((t) => t[0] === "mint").map((t) => ({ mint: t[1], units: t.slice(2).filter(Boolean) }));
  });
}

/** Returns the pubkey for P2PK-locking from a kind:10019 nutzap info event */
export function getNutzapInfoPubkey(event: NostrEvent): string | undefined {
  return event.tags.find((t) => t[0] === "pubkey")?.[1];
}

/**
 * verfies if proofs are locked to nutzap info
 * @throws {Error} if proofs are not locked to nutzap info
 */
export function verifyProofsLocked(proofs: Proof[], info: NostrEvent) {
  const pubkey = getNutzapInfoPubkey(info);
  if (!pubkey) throw new Error("Nutzap info must have a pubkey");

  const fullPubkey = pubkey.length === 64 ? `02${pubkey}` : pubkey;

  for (const proof of proofs) {
    const secret = safeParse(proof.secret);
    if (!secret) throw new Error(`Cashu token must have a spending condition`);
    if (!Array.isArray(secret)) throw new Error("Invalid spending condition");
    if (secret[0] !== "P2PK") throw new Error("Token proofs must be P2PK locked");
    if (secret[1].data !== fullPubkey)
      throw new Error("Token proofs must be P2PK locked to the recipient's nutzap pubkey");
  }
}
