import { Proof } from "@cashu/cashu-ts";
import {
  getAddressPointerFromATag,
  getEventPointerFromETag,
  getOrComputeCachedValue,
  getProfilePointerFromPTag,
  getPublicKey,
  getTagValue,
  isPTag,
  KnownEvent,
  processTags,
  safeParse,
} from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { getHistoryRedeemed } from "./history.js";
import { getProofP2PKPubkey } from "./cashu.js";

export const NUTZAP_KIND = 9321;

/** Validated NIP-61 nutzap event */
export type NutzapEvent = KnownEvent<typeof NUTZAP_KIND>;

// Symbols for caching computed values
export const NutzapProofsSymbol = Symbol.for("nutzap-proofs");
export const NutzapAmountSymbol = Symbol.for("nutzap-amount");
export const NutzapMintSymbol = Symbol.for("nutzap-mint");

/** Returns the cashu proofs from a kind:9321 nutzap event */
export function getNutzapProofs(event: NostrEvent): Proof[] {
  return getOrComputeCachedValue(event, NutzapProofsSymbol, () => {
    return processTags(event.tags, (tag) => (tag[0] === "proof" ? safeParse(tag[1]) : undefined));
  });
}

/** Returns the mint URL from a kind:9321 nutzap event */
export function getNutzapMint(event: NutzapEvent): string;
export function getNutzapMint(event: NostrEvent): string | undefined;
export function getNutzapMint(event: NostrEvent): string | undefined {
  return getOrComputeCachedValue(event, NutzapMintSymbol, () => {
    const url = getTagValue(event, "u");
    return url && URL.canParse(url) ? url : undefined;
  });
}

/** Returns the recipient pubkey from a kind:9321 nutzap event */
export function getNutzapRecipient(event: NutzapEvent): ProfilePointer;
export function getNutzapRecipient(event: NostrEvent): ProfilePointer | undefined;
export function getNutzapRecipient(event: NostrEvent): ProfilePointer | undefined {
  const tag = event.tags.find(isPTag);
  return tag ? (getProfilePointerFromPTag(tag) ?? undefined) : undefined;
}

/** Returns the event ID being nutzapped from a kind:9321 nutzap event */
export function getNutzapEventPointer(event: NostrEvent): EventPointer | undefined {
  const tag = event.tags.find((t) => t[0] === "e");
  if (!tag) return;
  return getEventPointerFromETag(tag) ?? undefined;
}

/** Returns the event ID being nutzapped from a kind:9321 nutzap event */
export function getNutzapAddressPointer(event: NostrEvent): AddressPointer | undefined {
  const tag = event.tags.find((t) => t[0] === "a");
  if (!tag) return;
  return getAddressPointerFromATag(tag) ?? undefined;
}

/** Returns the EventPointer or AddressPointer from a kind:9321 nutzap event */
export function getNutzapPointer(event: NostrEvent): EventPointer | AddressPointer | undefined {
  return getNutzapEventPointer(event) ?? getNutzapAddressPointer(event);
}

/** Returns the comment from a kind:9321 nutzap event */
export function getNutzapComment(event: NostrEvent): string | undefined {
  return event.content || undefined;
}

/** Calculates the total amount of sats in a kind:9321 nutzap event */
export function getNutzapAmount(event: NutzapEvent): number;
export function getNutzapAmount(event: NostrEvent): number | undefined;
export function getNutzapAmount(event: NostrEvent): number | undefined {
  return getOrComputeCachedValue(event, NutzapAmountSymbol, () => {
    const proofs = getNutzapProofs(event);
    return proofs.reduce((total, proof) => total + (proof.amount || 0), 0);
  });
}

/** Checks if a nutzap is valid according to NIP-61 requirements */
export function isValidNutzap(nutzap: NostrEvent): nutzap is NutzapEvent {
  if (nutzap.kind !== NUTZAP_KIND) return false;

  // Check if the nutzap has a mint, recipient, and proofs
  if (getNutzapPointer(nutzap) === undefined) return false;
  if (getNutzapMint(nutzap) === undefined) return false;
  if (getNutzapRecipient(nutzap) === undefined) return false;
  if (getNutzapProofs(nutzap).length === 0) return false;

  return true;
}

/** Checks if a nutzap event has already been redeemed based on kind:7376 wallet history events */
export function isNutzapRedeemed(nutzapId: string, history: NostrEvent[]): boolean {
  return history.some((entry) => getHistoryRedeemed(entry).includes(nutzapId));
}

/**
 * Extracts the P2PK locking pubkey from proofs in a nutzap event
 * @param nutzap the nutzap event containing P2PK-locked proofs
 * @returns the pubkey that the proofs are locked to, or undefined if not found
 * @throws {Error} if proofs are not P2PK locked or have inconsistent pubkeys
 */
export function getNutzapP2PKPubkey(nutzap: NostrEvent): string | undefined {
  const proofs = getNutzapProofs(nutzap);
  if (proofs.length === 0) return undefined;

  let p2pkPubkey: string | undefined;

  for (const proof of proofs) {
    const proofPubkey = getProofP2PKPubkey(proof);
    if (!proofPubkey) throw new Error("Proof is not P2PK locked");

    if (!p2pkPubkey) {
      p2pkPubkey = proofPubkey;
    } else if (p2pkPubkey !== proofPubkey) {
      throw new Error("Proofs are locked to different pubkeys");
    }
  }

  return p2pkPubkey;
}

/**
 * Finds the matching private key for the P2PK lock in a nutzap event's proofs
 * @param nutzap the nutzap event containing P2PK-locked proofs
 * @param privateKeys array of private keys to search through
 * @returns the matching private key, or undefined if none match
 * @throws {Error} if proofs are not P2PK locked or have inconsistent pubkeys
 */
export function findMatchingPrivateKeyForNutzap(nutzap: NostrEvent, privateKeys: Uint8Array[]): Uint8Array | undefined {
  const p2pkPubkey = getNutzapP2PKPubkey(nutzap);
  if (!p2pkPubkey) return undefined;

  // Normalize target pubkey to full format (with 02 prefix) for comparison
  // getNutzapP2PKPubkey already normalizes to full format, so p2pkPubkey is 66 chars
  const targetPubkeyFull = p2pkPubkey;
  const targetPubkeyXOnly = p2pkPubkey.length === 66 ? p2pkPubkey.slice(2) : p2pkPubkey;

  for (const privateKey of privateKeys) {
    try {
      // Derive public key from private key (returns 64-char x-only format)
      const derivedPubkey = getPublicKey(privateKey);

      // Compare: derived pubkey is x-only, so compare both formats
      if (derivedPubkey === targetPubkeyXOnly || `02${derivedPubkey}` === targetPubkeyFull) {
        return privateKey;
      }
    } catch (error) {
      // Skip invalid private keys
      continue;
    }
  }

  return undefined;
}
