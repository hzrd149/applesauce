import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { KnownEvent, verifyWrappedEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import { getAddressPointerFromATag, getEventPointerFromETag } from "applesauce-core/helpers/pointers";
import { isATag, isETag } from "applesauce-core/helpers/tags";
import { kinds, NostrEvent, validateEvent } from "nostr-tools";
import { AddressPointer, EventPointer } from "nostr-tools/nip19";

import { parseBolt11, ParsedInvoice } from "./bolt11.js";

/** Type for validated zap event */
export type ZapEvent = KnownEvent<kinds.Zap>;

export const ZapRequestSymbol = Symbol.for("zap-request");
export const ZapSenderSymbol = Symbol.for("zap-sender");
export const ZapReceiverSymbol = Symbol.for("zap-receiver");
export const ZapInvoiceSymbol = Symbol.for("zap-bolt11");
export const ZapEventPointerSymbol = Symbol.for("zap-event-pointer");
export const ZapAddressPointerSymbol = Symbol.for("zap-address-pointer");

/** Returns the senders pubkey */
export function getZapSender(zap: ZapEvent): string;
export function getZapSender(zap: NostrEvent): string | undefined;
export function getZapSender(zap: NostrEvent): string | undefined {
  return getOrComputeCachedValue(zap, ZapSenderSymbol, () => {
    return getTagValue(zap, "P") || getZapRequest(zap)?.pubkey;
  });
}

/** Gets the receivers pubkey */
export function getZapRecipient(zap: ZapEvent): string;
export function getZapRecipient(zap: NostrEvent): string | undefined;
export function getZapRecipient(zap: NostrEvent): string | undefined {
  return getOrComputeCachedValue(zap, ZapReceiverSymbol, () => {
    return getTagValue(zap, "p");
  });
}

/** Returns the parsed bolt11 invoice */
export function getZapPayment(zap: ZapEvent): ParsedInvoice;
export function getZapPayment(zap: NostrEvent): ParsedInvoice | undefined;
export function getZapPayment(zap: NostrEvent): ParsedInvoice | undefined {
  return getOrComputeCachedValue(zap, ZapInvoiceSymbol, () => {
    const bolt11 = getTagValue(zap, "bolt11");
    try {
      // Catch errors with parsing the bolt11 invoice
      return bolt11 ? parseBolt11(bolt11) : undefined;
    } catch (error) {
      return undefined;
    }
  });
}

/** Returns the zap event amount in msats */
export function getZapAmount(zap: ZapEvent): number;
export function getZapAmount(zap: NostrEvent): number | undefined;
export function getZapAmount(zap: NostrEvent): number | undefined {
  return getZapPayment(zap)?.amount;
}

/** Gets the AddressPointer that was zapped */
export function getZapAddressPointer(zap: NostrEvent): AddressPointer | null {
  return getOrComputeCachedValue(zap, ZapAddressPointerSymbol, () => {
    const a = zap.tags.find(isATag);
    return a ? getAddressPointerFromATag(a) : null;
  });
}

/** Gets the EventPointer that was zapped */
export function getZapEventPointer(zap: NostrEvent): EventPointer | null {
  return getOrComputeCachedValue(zap, ZapEventPointerSymbol, () => {
    const e = zap.tags.find(isETag);
    return e ? getEventPointerFromETag(e) : null;
  });
}

/** Gets the preimage for the bolt11 invoice */
export function getZapPreimage(zap: NostrEvent): string | undefined {
  return getTagValue(zap, "preimage");
}

/** Returns the zap request event inside the zap receipt */
export function getZapRequest(zap: ZapEvent): NostrEvent;
export function getZapRequest(zap: NostrEvent): NostrEvent | undefined;
export function getZapRequest(zap: NostrEvent): NostrEvent | undefined {
  return getOrComputeCachedValue(zap, ZapRequestSymbol, () => {
    const description = getTagValue(zap, "description");
    if (!description) return;

    // Attempt to parse the zap request
    try {
      // Copied from nostr-tools/nip57 and modified to use the internal verifyZap method and return the zap request event
      let zapRequest: NostrEvent;

      try {
        zapRequest = JSON.parse(description);
      } catch (err) {
        throw new Error("Invalid zap request JSON.");
      }

      if (!validateEvent(zapRequest)) throw new Error("Zap request is not a valid Nostr event.");
      if (!verifyWrappedEvent(zapRequest)) throw new Error("Invalid signature on zap request.");

      let p = zapRequest.tags.find(([t, v]) => t === "p" && v);
      if (!p) throw new Error("Zap request doesn't have a 'p' tag.");
      if (!p[1].match(/^[a-f0-9]{64}$/)) throw new Error("Zap request 'p' tag is not valid hex.");

      let e = zapRequest.tags.find(([t, v]) => t === "e" && v);
      if (e && !e[1].match(/^[a-f0-9]{64}$/)) throw new Error("Zap request 'e' tag is not valid hex.");

      let relays = zapRequest.tags.find(([t, v]) => t === "relays" && v);
      if (!relays) throw new Error("Zap request doesn't have a 'relays' tag.");

      return zapRequest;
    } catch (error) {
      return undefined;
    }
  });
}

/**
 * Checks if a zap event is valid (not missing fields)
 * DOES NOT validate LNURL address
 */
export function isValidZap(zap?: NostrEvent): zap is ZapEvent {
  if (!zap) return false;
  if (zap.kind !== kinds.Zap) return false;

  // Is not a valid zap kind if any of these is undefined
  if (getZapPayment(zap) === undefined) return false;
  if (getZapRequest(zap) === undefined) return false;
  if (getZapRecipient(zap) === undefined) return false;
  if (getZapSender(zap) === undefined) return false;

  return true;
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
