import { NostrEvent } from "nostr-tools";
import type { TagOperation } from "../../factories/types.js";
import {
  createATagFromAddressPointer,
  createETagFromEventPointer,
  createPTagFromProfilePointer,
} from "../../helpers/factory.js";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  getEventPointerForEvent,
  getReplaceableAddressFromPointer,
  parseReplaceableAddress,
  ProfilePointer,
} from "../../helpers/pointers.js";
import { ensureNamedValueTag, ensureSingletonTag } from "../../helpers/tags.js";
import { getReplaceableAddress, isEvent, skip } from "../../helpers/index.js";

/**
 * Adds a single "p" tag for a ProfilePointer
 * @param pubkey - Pubkey string or ProfilePointer object
 * @param relayHint - Optional relay hint (string) or function to get relay hint
 * @param replace - If true, removes existing "p" tags for this pubkey
 */
export function addProfilePointerTag(
  pubkey: string | ProfilePointer,
  relayHint?: string | ((pubkey: string) => Promise<string | undefined>),
  replace = true,
): TagOperation {
  return async (tags) => {
    const pointer = typeof pubkey === "string" ? { pubkey: pubkey } : { ...pubkey };

    // add relay hint (hybrid: string or function)
    if (!pointer.relays?.[0] && relayHint) {
      const hint = typeof relayHint === "string" ? relayHint : await relayHint(pointer.pubkey);
      if (hint) pointer.relays = [hint];
    }

    // remove matching "p" tags
    if (replace) tags = tags.filter((t) => !(t[0] === "p" && t[1] === pointer.pubkey));

    // add "p" tag
    return [...tags, createPTagFromProfilePointer(pointer)];
  };
}

/** Removes all "p" tags matching a pubkey */
export function removeProfilePointerTag(pubkey: string | ProfilePointer): TagOperation {
  pubkey = typeof pubkey !== "string" ? pubkey.pubkey : pubkey;
  return (tags) => tags.filter((t) => !(t[0] === "p" && t[1] === pubkey));
}

/**
 * Adds a single "e" tag for an EventPointer
 * @param id - Event ID string, EventPointer object, or NostrEvent
 * @param relayHint - Optional relay hint (string) or function to get relay hint
 * @param replace - If true, removes existing "e" tags for this event ID
 */
export function addEventPointerTag(
  id: string | EventPointer | NostrEvent,
  relayHint?: string | ((eventId: string) => Promise<string | undefined>),
  replace = true,
): TagOperation {
  return async (tags) => {
    const pointer = typeof id === "string" ? { id } : isEvent(id) ? getEventPointerForEvent(id) : id;

    // add relay hint (hybrid: string or function)
    if (!pointer.relays?.[0] && relayHint) {
      const hint = typeof relayHint === "string" ? relayHint : await relayHint(pointer.id);
      if (hint) pointer.relays = [hint];
    }

    // remove matching "e" tags
    if (replace) tags = tags.filter((t) => !(t[0] === "e" && t[1] === pointer.id));

    // add "e" tag
    return [...tags, createETagFromEventPointer(pointer)];
  };
}

/** Removes all "e" tags matching EventPointer or id */
export function removeEventPointerTag(id: string | EventPointer): TagOperation {
  id = typeof id === "string" ? id : id.id;
  return (tags) => tags.filter((t) => !(t[0] === "e" && t[1] === id));
}

/**
 * Adds a single "a" tag based on an AddressPointer
 * @param address - Address string, AddressPointer object, or NostrEvent
 * @param relayHint - Optional relay hint (string) or function to get relay hint
 * @param replace - If true, removes existing "a" tags for this address
 */
export function addAddressPointerTag(
  address: string | AddressPointer | NostrEvent,
  relayHint?: string | ((pubkey: string) => Promise<string | undefined>),
  replace = true,
): TagOperation {
  // convert the string into an address pointer object
  const pointer =
    typeof address === "string"
      ? parseReplaceableAddress(address)
      : isEvent(address)
        ? getAddressPointerForEvent(address)
        : address;
  if (!pointer) throw new Error("Unable to resolve address pointer");

  return async (tags) => {
    const replaceableAddress = typeof address === "string" ? address : getReplaceableAddressFromPointer(pointer);

    // add relay hint if there isn't one (hybrid: string or function)
    if (!pointer.relays?.[0] && relayHint) {
      const hint = typeof relayHint === "string" ? relayHint : await relayHint(pointer.pubkey);
      if (hint) pointer.relays = [hint];
    }

    // remove existing "a" tags matching coordinate
    if (replace) tags = tags.filter((t) => !(t[0] === "a" && t[1] === replaceableAddress));

    // add "a" tag
    return [...tags, createATagFromAddressPointer(pointer)];
  };
}

/** Removes all "a" tags for address pointer */
export function removeAddressPointerTag(address: string | AddressPointer | NostrEvent): TagOperation {
  const addressString =
    typeof address !== "string"
      ? isEvent(address)
        ? getReplaceableAddress(address)
        : getReplaceableAddressFromPointer(address)
      : address;

  if (!addressString) return skip(); // skip if the address string is not valid

  return (tags) => tags.filter((t) => !(t[0] === "a" && t[1] === addressString));
}

/** Adds a name / value tag */
export function addNameValueTag(
  tag: [string, string, ...string[]],
  replace = true,
  matcher?: (a: string, b: string) => boolean,
): TagOperation {
  return (tags) => {
    // replace or append tag
    if (replace) return ensureNamedValueTag(tags, tag, true, matcher);
    else return [...tags, tag];
  };
}
/** Removes all matching name / value tag */
export function removeNameValueTag(tag: string[]): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tag[0] && t[1] === tag[1]));
}

/** Sets a singleton tag */
export function setSingletonTag(tag: [string, ...string[]], replace = true): TagOperation {
  return (tags) => ensureSingletonTag(tags, tag, replace);
}

/** Removes all instances of a singleton tag */
export function removeSingletonTag(tag: string): TagOperation {
  return (tags) => tags.filter((t) => !(t[0] === tag));
}
