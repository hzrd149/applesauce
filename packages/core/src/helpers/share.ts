import { nip18, NostrEvent } from "nostr-tools";
import { getOrComputeCachedValue } from "./cache.js";
import { AddressPointer, EventPointer } from "nostr-tools/nip19";
import { isATag, isETag } from "./tags.js";
import { getAddressPointerFromATag, getEventPointerFromETag } from "./pointers.js";

export const SharedEventSymbol = Symbol.for("shared-event");
export const SharedEventPointerSymbol = Symbol.for("shared-event-pointer");
export const SharedAddressPointerSymbol = Symbol.for("shared-address-pointer");
/** Returns the event pointer of a kind 6 or 16 share event */
export function getSharedEventPointer(event: NostrEvent): EventPointer | undefined {
  return getOrComputeCachedValue(event, SharedEventPointerSymbol, () => {
    const e = event.tags.find(isETag);
    if (!e) return undefined;

    return getEventPointerFromETag(e);
  });
}

/** Returns the address pointer of a kind 6 or 16 share event */
export function getSharedAddressPointer(event: NostrEvent): AddressPointer | undefined {
  return getOrComputeCachedValue(event, SharedAddressPointerSymbol, () => {
    const a = event.tags.find(isATag);
    if (!a) return undefined;

    return getAddressPointerFromATag(a);
  });
}

/** Returns the stringified event in the content of a kind 6 or 16 share event */
export function getEmbededSharedEvent(event: NostrEvent): NostrEvent | undefined {
  return getOrComputeCachedValue(event, SharedEventSymbol, () => nip18.getRepostedEvent(event));
}

/** @deprecated use getEmbededSharedEvent instead */
export const parseSharedEvent = getEmbededSharedEvent;
