import { getOrComputeCachedValue, isEvent, safeParse, verifyWrappedEvent } from "applesauce-core/helpers";
import { KnownEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
} from "applesauce-core/helpers/pointers";
import { isATag, isETag } from "applesauce-core/helpers/tags";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";

/** Type of a known share event */
export type ShareEvent = KnownEvent<kinds.Repost | kinds.GenericRepost>;

export const SharedEventSymbol = Symbol.for("shared-event");
export const SharedEventPointerSymbol = Symbol.for("shared-event-pointer");
export const SharedAddressPointerSymbol = Symbol.for("shared-address-pointer");

/** Returns the event pointer of a kind 6 or 16 share event */
export function getSharedEventPointer(event: ShareEvent): EventPointer;
export function getSharedEventPointer(event: NostrEvent): EventPointer | undefined;
export function getSharedEventPointer(event: NostrEvent): EventPointer | undefined {
  return getOrComputeCachedValue(event, SharedEventPointerSymbol, () => {
    const e = event.tags.find(isETag);
    if (!e) return undefined;

    // Get kind from k tag if it exists
    const kStr = getTagValue(event, "k");
    const k = kStr ? parseInt(kStr) : undefined;

    const pointer = getEventPointerFromETag(e);
    if (pointer && k !== undefined) pointer.kind = k;
    return pointer ?? undefined;
  });
}

/** Returns the address pointer of a kind 6 or 16 share event */
export function getSharedAddressPointer(event: NostrEvent): AddressPointer | undefined {
  return getOrComputeCachedValue(event, SharedAddressPointerSymbol, () => {
    const a = event.tags.find(isATag);
    if (!a) return undefined;

    return getAddressPointerFromATag(a) ?? undefined;
  });
}

/** Returns the stringified event in the content of a kind 6 or 16 share event */
export function getEmbededSharedEvent(event: NostrEvent): NostrEvent | undefined {
  return getOrComputeCachedValue(event, SharedEventSymbol, () => {
    const pointer = getSharedEventPointer(event);
    if (pointer === undefined || event.content === "") return undefined;

    const sharedEvent = safeParse<NostrEvent>(event.content);

    // Ensure event is a valid Nostr event
    if (!isEvent(sharedEvent)) return undefined;

    // Ensure event id matches the pointer
    if (sharedEvent.id !== pointer.id) return undefined;

    // Ensure event is verified
    if (!verifyWrappedEvent(sharedEvent)) return undefined;

    return sharedEvent;
  });
}

/** @deprecated use getEmbededSharedEvent instead */
export const parseSharedEvent = getEmbededSharedEvent;

/** Validates that an event is a valid share event */
export function isValidShare(event?: NostrEvent): event is ShareEvent {
  if (!event) return false;

  return (
    (event.kind === kinds.Repost || event.kind === kinds.GenericRepost) && getSharedEventPointer(event) !== undefined
  );
}
