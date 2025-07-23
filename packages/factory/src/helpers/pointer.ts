import { getCoordinateFromAddressPointer, NameValueTag } from "applesauce-core/helpers";
import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";

import { fillAndTrimTag } from "./tag.js";

/** Returns a tag for an address pointer */
export function createATagFromAddressPointer(pointer: AddressPointer): NameValueTag {
  const coordinate = getCoordinateFromAddressPointer(pointer);
  return fillAndTrimTag(["a", coordinate, pointer.relays?.[0]]) as NameValueTag;
}

export type Nip10TagMarker = "root" | "reply" | "mention" | "";

/** Returns a tag for an event pointer with a marker*/
export function createETagWithMarkerFromEventPointer(pointer: EventPointer, marker?: Nip10TagMarker): NameValueTag {
  return fillAndTrimTag(["e", pointer.id, pointer.relays?.[0], marker, pointer.author]) as NameValueTag;
}

/** Returns a tag for an event pointer without a marker */
export function createETagFromEventPointer(pointer: EventPointer): NameValueTag {
  return fillAndTrimTag(["e", pointer.id, pointer.relays?.[0]]) as NameValueTag;
}

/** Returns a tag for an profile pointer */
export function createPTagFromProfilePointer(pointer: ProfilePointer): NameValueTag {
  return fillAndTrimTag(["p", pointer.pubkey, pointer.relays?.[0]]) as NameValueTag;
}
