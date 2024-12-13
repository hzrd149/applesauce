import { kinds, nip57, NostrEvent } from "nostr-tools";
import { getOrComputeCachedValue } from "./cache.js";
import { getTagValue } from "./event.js";
import { isATag, isETag } from "./tags.js";
import { getAddressPointerFromATag, getEventPointerFromETag } from "./pointers.js";
import { parseBolt11 } from "./bolt11.js";

export const ZapRequestSymbol = Symbol.for("zap-request");
export const ZapFromSymbol = Symbol.for("zap-from");
export const ZapInvoiceSymbol = Symbol.for("zap-bolt11");
export const ZapEventPointerSymbol = Symbol.for("zap-event-pointer");
export const ZapAddressPointerSymbol = Symbol.for("zap-address-pointer");

/** Returns the senders pubkey */
export function getZapSender(zap: NostrEvent) {
  return getTagValue(zap, "P") || getZapRequest(zap).pubkey;
}

/**
 * Gets the receivers pubkey
 * @throws
 */
export function getZapRecipient(zap: NostrEvent) {
  const recipient = getTagValue(zap, "p");
  if (!recipient) throw new Error("Missing recipient");
  return recipient;
}

/** Returns the parsed bolt11 invoice */
export function getZapPayment(zap: NostrEvent) {
  return getOrComputeCachedValue(zap, ZapInvoiceSymbol, () => {
    const bolt11 = getTagValue(zap, "bolt11");
    return bolt11 ? parseBolt11(bolt11) : undefined;
  });
}

/** Gets the AddressPointer that was zapped */
export function getZapAddressPointer(zap: NostrEvent) {
  return getOrComputeCachedValue(zap, ZapAddressPointerSymbol, () => {
    const a = zap.tags.find(isATag);
    return a ? getAddressPointerFromATag(a) : null;
  });
}

/** Gets the EventPointer that was zapped */
export function getZapEventPointer(zap: NostrEvent) {
  return getOrComputeCachedValue(zap, ZapEventPointerSymbol, () => {
    const e = zap.tags.find(isETag);
    return e ? getEventPointerFromETag(e) : null;
  });
}

/** Gets the preimage for the bolt11 invoice */
export function getZapPreimage(zap: NostrEvent) {
  return getTagValue(zap, "preimage");
}

/**
 * Returns the zap request event inside the zap receipt
 * @throws
 */
export function getZapRequest(zap: NostrEvent) {
  return getOrComputeCachedValue(zap, ZapRequestSymbol, () => {
    const description = getTagValue(zap, "description");
    if (!description) throw new Error("Missing description tag");
    const error = nip57.validateZapRequest(description);
    if (error) throw new Error(error);
    return JSON.parse(description) as NostrEvent;
  });
}

/**
 * Checks if the zap is valid
 * DOES NOT validate LNURL address
 */
export function isValidZap(zap?: NostrEvent) {
  if (!zap) return false;
  if (zap.kind !== kinds.Zap) return false;
  try {
    getZapRequest(zap);
    getZapRecipient(zap);
    return true;
  } catch (error) {
    return false;
  }
}

export type ZapSplit = { pubkey: string; percent: number; weight: number; relay?: string };

/** Returns the zap splits for an event */
export function getZapSplits(event: NostrEvent): ZapSplit[] | undefined {
  const tags = event.tags.filter((t) => t[0] === "zap" && t[1] && t[3]) as [string, string, string, string][];

  if (tags.length > 0) {
    const targets = tags
      .map((t) => ({ pubkey: t[1], relay: t[2], weight: parseFloat(t[3]) }))
      .filter((p) => Number.isFinite(p.weight));

    const total = targets.reduce((v, p) => v + p.weight, 0);
    return targets.map((p) => ({ ...p, percent: p.weight / total }));
  }

  return undefined;
}
