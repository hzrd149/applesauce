import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";
import {
  createATagFromAddressPointer,
  createETagFromEventPointer,
  createETagWithMarkerFromEventPointer,
  createPTagFromProfilePointer,
  Nip10TagMarker,
} from "./pointer.js";
import { fillAndTrimTag } from "./tag.js";
import { getCoordinateFromAddressPointer } from "applesauce-core/helpers";

/** Adds or merges an EventPointer with marker into a tags list */
export function ensureMarkedEventPointerTag(
  tags: string[][],
  pointer: EventPointer,
  marker?: Nip10TagMarker,
): string[][] {
  const existing = tags.find((t) => t[0] === "e" && t[1] === pointer.id && (t[3] ?? "") === (marker ?? ""));

  if (existing) {
    const merged = fillAndTrimTag([
      "e",
      pointer.id,
      existing[2] || pointer.relays?.[0],
      // markers should always be equal
      marker,
      existing[4] || pointer.author,
    ]);

    // replace tag
    return tags.map((t) => (t === existing ? merged : t));
  }
  return [...tags, createETagWithMarkerFromEventPointer(pointer, marker)];
}

/**
 * Adds or merges an EventPointer without marker or pubkey into a tags list
 * NOTE: this should not be used for kind 1 notes
 */
export function ensureEventPointerTag(tags: string[][], pointer: EventPointer): string[][] {
  const existing = tags.find((t) => t[0] === "e" && t[1] === pointer.id);

  if (existing) {
    const merged = fillAndTrimTag(["e", pointer.id, existing[2] || pointer.relays?.[0]]);
    return tags.map((t) => (t === existing ? merged : t));
  }
  return [...tags, createETagFromEventPointer(pointer)];
}

/** Adds or merges an ProfilePointer into a tags list */
export function ensureMarkedProfilePointerTag(tags: string[][], pointer: ProfilePointer, marker: string): string[][] {
  const existing = tags.find((t) => t[0] === "p" && t[1] === pointer.pubkey && (t[3] ?? "") === (marker ?? ""));

  if (existing) {
    const merged = fillAndTrimTag([
      "p",
      pointer.pubkey,
      existing[2] || pointer.relays?.[0],
      // markers should always be equal
      marker,
    ]);

    // replace tag
    return tags.map((t) => (t === existing ? merged : t));
  }
  return [...tags, fillAndTrimTag(["p", pointer.pubkey, pointer.relays?.[0], marker])];
}

/** Adds or merges an ProfilePointer into a tags list */
export function ensureProfilePointerTag(tags: string[][], pointer: ProfilePointer): string[][] {
  const existing = tags.find((t) => t[0] === "p" && t[1] === pointer.pubkey);

  if (existing) {
    const merged = fillAndTrimTag(["p", pointer.pubkey, existing[2] || pointer.relays?.[0]]);

    // replace tag
    return tags.map((t) => (t === existing ? merged : t));
  }
  return [...tags, createPTagFromProfilePointer(pointer)];
}

/** Adds or merges an AddressPointer into a tags list */
export function ensureAddressPointerTag(tags: string[][], pointer: AddressPointer): string[][] {
  const coordinate = getCoordinateFromAddressPointer(pointer);
  const existing = tags.find((t) => t[0] === "a" && t[1] === coordinate);

  if (existing) {
    const merged = fillAndTrimTag(["a", coordinate, existing[2] || pointer.relays?.[0]]);

    // replace tag
    return tags.map((t) => (t === existing ? merged : t));
  }
  return [...tags, createATagFromAddressPointer(pointer)];
}

/** Adds or merges a marked AddressPointer into a tags list */
export function ensureMarkedAddressPointerTag(
  tags: string[][],
  pointer: AddressPointer,
  marker: Nip10TagMarker,
): string[][] {
  const coordinate = getCoordinateFromAddressPointer(pointer);
  const existing = tags.find((t) => t[0] === "a" && t[1] === coordinate && (t[3] ?? "") === (marker ?? ""));

  if (existing) {
    const merged = fillAndTrimTag(["a", coordinate, existing[2] || pointer.relays?.[0], existing[3]]);

    // replace tag
    return tags.map((t) => (t === existing ? merged : t));
  }
  return [...tags, fillAndTrimTag(["a", coordinate, pointer.relays?.[0], marker])];
}

/** Ensures an array of tags includes a simple "k" tag */
export function ensureKTag(tags: string[][], kind: number): string[][] {
  const existing = tags.find((t) => t[0] === "k" && t[1] === String(kind));
  if (!existing) return [...tags, ["k", String(kind)]];
  return tags;
}
