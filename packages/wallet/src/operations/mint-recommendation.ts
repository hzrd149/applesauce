import { EventOperation } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { modifyPublicTags } from "applesauce-core/operations";
import { setContent } from "applesauce-core/operations/content";
import { addAddressPointerTag, setSingletonTag } from "applesauce-core/operations/tag/common";

/** Sets the recommended event kind (should be 38172 for cashu mints) */
export function setKind(kind: number): EventOperation {
  return modifyPublicTags(setSingletonTag(["k", kind.toString()]));
}

/** Sets the mint's pubkey (the `d` tag, which is the replaceable identifier) */
export function setMintPubkey(pubkey: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["d", pubkey]));
}

/** Sets the optional URL to connect to the cashu mint (the `u` tag) */
export function setURL(url: string): EventOperation {
  // Enforce valid URL for cashu mints
  if (url && !URL.canParse(url)) throw new Error("Invalid URL");
  return modifyPublicTags(setSingletonTag(["u", url]));
}

/** Sets the optional address pointer to the kind:38172 event (the `a` tag) */
export function setAddressPointer(pointer: AddressPointer | NostrEvent | string): EventOperation {
  return modifyPublicTags(addAddressPointerTag(pointer, undefined, true));
}

/** Sets the optional review/comment content */
export function setComment(comment: string): EventOperation {
  return setContent(comment);
}
