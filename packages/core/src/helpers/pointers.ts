import {
  AddressPointer,
  decode,
  DecodedResult,
  EventPointer,
  NAddr,
  naddrEncode,
  NEvent,
  neventEncode,
  noteEncode,
  NProfile,
  nprofileEncode,
  NPub,
  npubEncode,
  nsecEncode,
  ProfilePointer,
} from "nostr-tools/nip19";

// re-export types from nostr-tools/nip19
export type { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";

// export nip-19 helpers
export {
  decode as decodePointer,
  naddrEncode,
  neventEncode,
  noteEncode,
  nprofileEncode,
  npubEncode,
  nsecEncode,
} from "nostr-tools/nip19";
export type { NAddr, NEvent, NProfile, NPub } from "nostr-tools/nip19";

import { getPublicKey } from "nostr-tools/pure";
import { getReplaceableIdentifier, isAddressableKind, isReplaceableKind, kinds, NostrEvent } from "./event.js";
import { Tokens } from "./regexp.js";
import { isSafeRelayURL, relaySet } from "./relays.js";
import { isHexKey } from "./string.js";
import { normalizeURL } from "./url.js";

// re-export legacy DecodeResult type
export type DecodeResult = DecodedResult;

/** Decodes a string and handles errors. Returns null if the string cannot be decoded. */
function safeDecode(str: string): DecodedResult | null {
  try {
    return decode(str);
  } catch {
    return null;
  }
}

/** Decodes any NIP-19 encoded string into a ProfilePointer. Returns null if the string cannot be decoded. */
export function decodeProfilePointer(str: string): ProfilePointer | null {
  const result = safeDecode(str);
  if (!result) return null;
  const pubkey = getPubkeyFromDecodeResult(result);
  if (!pubkey) return null;

  return {
    pubkey,
    relays: getRelaysFromDecodeResult(result),
  };
}

/** Decodes an encoded NIP-19 naddr string to an AddressPointer. Returns null if the string cannot be decoded. */
export function decodeAddressPointer(str: string): AddressPointer | null {
  const result = safeDecode(str);
  if (!result) return null;
  return result.type === "naddr" ? result.data : null;
}

/** Decodes an encoded NIP-19 note1 or nevent string to an EventPointer. Returns null if the string cannot be decoded. */
export function decodeEventPointer(str: string): EventPointer | null {
  const result = safeDecode(str);
  if (!result) return null;

  switch (result.type) {
    case "note":
      return { id: result.data };
    case "nevent":
      return result.data;
    default:
      return null;
  }
}

export type AddressPointerWithoutD = Omit<AddressPointer, "identifier"> & {
  identifier?: string;
};

/** Parses the value of an "a" tag into an AddressPointer. Returns null if the address cannot be parsed. */
export function parseReplaceableAddress(address: string, requireIdentifier = false): AddressPointer | null {
  const parts = address.split(":") as (string | undefined)[];
  const kind = parts[0] ? parseInt(parts[0]) : undefined;
  const pubkey = parts[1];

  // Check valid kind
  if (kind === undefined) return null;

  // Check valid pubkey
  if (pubkey === undefined || pubkey === "" || !isHexKey(pubkey)) return null;

  // Reconstruct identifier by joining all remaining parts after pubkey
  // This handles cases where the identifier contains colons (e.g., URLs)
  const identifier = parts.slice(2).join(":");

  // Return null if identifier is required and missing
  if (requireIdentifier && identifier === "") return null;

  return {
    kind,
    pubkey,
    identifier,
  };
}

/** Extracts a pubkey from the result of nip19.decode  Returns undefined if the decode result does not have a pubkey */
export function getPubkeyFromDecodeResult(result?: DecodeResult): string | undefined {
  if (!result) return;
  switch (result.type) {
    case "naddr":
    case "nprofile":
      return result.data.pubkey;
    case "npub":
      return result.data;
    case "nsec":
      return getPublicKey(result.data);
    default:
      return undefined;
  }
}

/** Extracts the relays from a decode result */
export function getRelaysFromDecodeResult(result?: DecodeResult): string[] | undefined {
  if (!result) return;
  switch (result.type) {
    case "naddr":
      return result.data.relays;
    case "nprofile":
      return result.data.relays;
    case "nevent":
      return result.data.relays;
  }
  return undefined;
}

/** Encodes the result of nip19.decode to a NIP-19 string. Returns an empty string if the result cannot be encoded. */
export function encodeDecodeResult(result: DecodeResult) {
  switch (result.type) {
    case "naddr":
      return naddrEncode(result.data);
    case "nprofile":
      return nprofileEncode(result.data);
    case "nevent":
      return neventEncode(result.data);
    case "nsec":
      return nsecEncode(result.data);
    case "npub":
      return npubEncode(result.data);
    case "note":
      return noteEncode(result.data);
  }

  return "";
}

/** Encodes a pointer to a NIP-19 string. Returns an empty string if the pointer cannot be encoded. */
export function encodePointer(pointer: AddressPointer | EventPointer | ProfilePointer): string {
  if (isAddressPointer(pointer)) return naddrEncode(pointer);
  else if (isEventPointer(pointer)) return neventEncode(pointer);
  else if (isProfilePointer(pointer)) return nprofileEncode(pointer);
  else return "";
}

/** Parses a common "e" tag into an EventPointer. Returns null if the tag cannot be parsed. */
export function getEventPointerFromETag(tag: string[]): EventPointer | null {
  const id = tag[1];
  if (!id || !isHexKey(id)) return null;
  const pointer: EventPointer = { id };
  if (tag[2] && isSafeRelayURL(tag[2])) pointer.relays = [normalizeURL(tag[2])];
  return pointer;
}

/** Parses a common "q" tag into an EventPointer. Returns null if the tag cannot be parsed. */
export function getEventPointerFromQTag(tag: string[]): EventPointer | null {
  const id = tag[1];
  if (!id || !isHexKey(id)) return null;
  const pointer: EventPointer = { id };
  if (tag[2] && isSafeRelayURL(tag[2])) pointer.relays = [normalizeURL(tag[2])];
  if (tag[3] && tag[3].length === 64) pointer.author = tag[3];
  return pointer;
}

/** Parses a common "a" tag into an AddressPointer. Returns null if the tag cannot be parsed. */
export function getAddressPointerFromATag(tag: string[]): AddressPointer | null {
  if (!tag[1]) return null;
  const pointer = parseReplaceableAddress(tag[1]);
  if (!pointer) return null;
  if (tag[2] && isSafeRelayURL(tag[2])) pointer.relays = [normalizeURL(tag[2])];
  return pointer;
}

/** Parses a common "p" tag into a ProfilePointer. Returns null if the tag cannot be parsed. */
export function getProfilePointerFromPTag(tag: string[]): ProfilePointer | null {
  const pubkey = tag[1];
  if (!pubkey || !isHexKey(pubkey)) return null;
  const pointer: ProfilePointer = { pubkey };
  if (tag[2] && isSafeRelayURL(tag[2])) pointer.relays = [normalizeURL(tag[2])];
  return pointer;
}

/** Checks if a pointer object is an AddressPointer */
export function isAddressPointer(pointer: any): pointer is AddressPointer {
  return (
    typeof pointer === "object" &&
    pointer !== null &&
    "identifier" in pointer &&
    "pubkey" in pointer &&
    "kind" in pointer &&
    typeof pointer.identifier === "string" &&
    typeof pointer.pubkey === "string" &&
    typeof pointer.kind === "number"
  );
}

/** Checks if a pointer object is a ProfilePointer */
export function isProfilePointer(pointer: any): pointer is ProfilePointer {
  return (
    typeof pointer === "object" &&
    pointer !== null &&
    "pubkey" in pointer &&
    typeof pointer.pubkey === "string" &&
    // Ensure its not an event or address pointer since they both have a pubkey fields
    !isEventPointer(pointer) &&
    !isAddressPointer(pointer)
  );
}

/** Checks if a pointer object is an EventPointer */
export function isEventPointer(pointer: any): pointer is EventPointer {
  return typeof pointer === "object" && pointer !== null && "id" in pointer && typeof pointer.id === "string";
}

/** Returns the stringified NIP-19 encoded naddr address pointer for an AddressPointer. */
export function getReplaceableAddressFromPointer(pointer: AddressPointer): string {
  return pointer.kind + ":" + pointer.pubkey + ":" + pointer.identifier;
}

/** Returns an AddressPointer for a replaceable event. Returns null if the event is not addressable or replaceable. */
export function getAddressPointerForEvent(event: NostrEvent, relays?: string[]): AddressPointer | null {
  if (!isAddressableKind(event.kind) && !isReplaceableKind(event.kind)) return null;
  const d = getReplaceableIdentifier(event);
  return { identifier: d, kind: event.kind, pubkey: event.pubkey, relays };
}

/** Returns an EventPointer for an event */
export function getEventPointerForEvent(event: NostrEvent, relays?: string[]): EventPointer {
  return {
    id: event.id,
    kind: event.kind,
    author: event.pubkey,
    relays,
  };
}

/** Returns a pointer for a given event */
export function getPointerForEvent(event: NostrEvent, relays?: string[]): DecodeResult {
  if (kinds.isAddressableKind(event.kind) || kinds.isReplaceableKind(event.kind)) {
    const pointer = getAddressPointerForEvent(event, relays);
    if (pointer)
      return {
        type: "naddr",
        data: pointer,
      };
  }
  return {
    type: "nevent",
    data: getEventPointerForEvent(event, relays),
  };
}

/** Adds relay hints to a pointer object that has a relays array */
export function addRelayHintsToPointer<T extends { relays?: string[] }>(pointer: T, relays?: Iterable<string>): T {
  if (!relays) return pointer;
  else return { ...pointer, relays: relaySet(relays, pointer.relays) };
}

/** Parses any nip-19 encoded string into a hex pubkey. Returns null if the string is not a valid pubkey. */
export function normalizeToPubkey(str: NPub): string;
export function normalizeToPubkey(str: string): string | null;
export function normalizeToPubkey(str: string): string | null {
  if (isHexKey(str)) return str.toLowerCase();
  else {
    const result = safeDecode(str);
    if (!result) return null;
    const pubkey = getPubkeyFromDecodeResult(result);
    if (!pubkey) return null;
    return pubkey;
  }
}

/** Parses any nip-19 encoded string into a ProfilePointer. Returns null if the string cannot be parsed. */
export function normalizeToProfilePointer(str: NProfile): ProfilePointer;
export function normalizeToProfilePointer(str: NPub): ProfilePointer;
export function normalizeToProfilePointer(str: string): ProfilePointer | null;
export function normalizeToProfilePointer(str: string): ProfilePointer | null {
  if (isHexKey(str)) return { pubkey: str.toLowerCase() };
  else {
    const result = safeDecode(str);
    if (!result) return null;

    // Return it if it's a profile pointer
    if (result.type === "nprofile") return result.data;

    // fallback to just getting the pubkey
    const pubkey = getPubkeyFromDecodeResult(result);
    if (!pubkey) return null;
    const relays = getRelaysFromDecodeResult(result);
    return { pubkey, relays };
  }
}

/** Parses any nip-19 encoded string into an AddressPointer. Returns null if the string cannot be parsed. */
export function normalizeToAddressPointer(str: NAddr): AddressPointer;
export function normalizeToAddressPointer(str: string): AddressPointer | null;
export function normalizeToAddressPointer(str: string): AddressPointer | null {
  // Handle <kind>:<pubkey>:<identifier> format
  if (str.includes(":")) return parseReplaceableAddress(str);

  // Decode nip-19 encoded string
  const result = safeDecode(str);
  if (!result) return null;
  return result.type === "naddr" ? result.data : null;
}

/** Parses any nip-19 encoded string into an EventPointer. Returns null if the string cannot be parsed. */
export function normalizeToEventPointer(str: NEvent): EventPointer;
export function normalizeToEventPointer(str: string): EventPointer | null;
export function normalizeToEventPointer(str: string): EventPointer | null {
  // Handle <event-id> format
  if (isHexKey(str)) return { id: str.toLowerCase() };

  // Decode nip-19 encoded string
  const result = safeDecode(str);
  if (!result) return null;

  switch (result.type) {
    case "nevent":
      return result.data;
    case "note":
      return { id: result.data };
    default:
      return null;
  }
}

/** Returns all NIP-19 pointers in a content string */
export function getContentPointers(content: string): DecodeResult[] {
  const mentions = content.matchAll(Tokens.nostrLink);

  const pointers: DecodeResult[] = [];
  for (const [_, $1] of mentions) {
    try {
      const result = safeDecode($1);
      if (!result) continue;
      pointers.push(result);
    } catch (error) {}
  }

  return pointers;
}

/**
 * Merges two event points and keeps all relays
 * @throws if the ids are different
 */
export function mergeEventPointers(a: EventPointer, b: EventPointer): EventPointer {
  if (a.id !== b.id) throw new Error("Cant merge event pointers with different ids");

  const relays = relaySet(a.relays, b.relays);
  return { id: a.id, kind: a.kind ?? b.kind, author: a.author ?? b.author, relays };
}

/**
 * Merges two address pointers and keeps all relays
 * @throws if the kinds, pubkeys, or identifiers are different
 */
export function mergeAddressPointers(a: AddressPointer, b: AddressPointer): AddressPointer {
  if (a.kind !== b.kind || a.pubkey !== b.pubkey || a.identifier !== b.identifier)
    throw new Error("Cant merge address pointers with different kinds, pubkeys, or identifiers");

  const relays = relaySet(a.relays, b.relays);
  return { ...a, relays };
}

/**
 * Merges two profile pointers and keeps all relays
 * @throws if the pubkeys are different
 */
export function mergeProfilePointers(a: ProfilePointer, b: ProfilePointer): ProfilePointer {
  if (a.pubkey !== b.pubkey) throw new Error("Cant merge profile pointers with different pubkeys");

  const relays = relaySet(a.relays, b.relays);
  return { ...a, relays };
}

/** Checks if an event matches a pointer */
export function eventMatchesPointer(
  event: NostrEvent,
  pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
): boolean {
  if (isEventPointer(pointer)) {
    return (
      event.id === pointer.id &&
      // if author is defined, check if it matches the event pubkey
      (pointer.author ? event.pubkey === pointer.author : true)
    );
  } else {
    return (
      event.kind === pointer.kind &&
      event.pubkey === pointer.pubkey &&
      getReplaceableIdentifier(event) === (pointer.identifier ?? "")
    );
  }
}
