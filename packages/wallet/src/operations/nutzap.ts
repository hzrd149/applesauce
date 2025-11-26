import { type Proof } from "@cashu/cashu-ts";
import { EventOperation, TagOperation } from "applesauce-core";
import { getReplaceableAddress, isAddressPointer, isEvent, isReplaceable } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { modifyPublicTags } from "applesauce-core/operations";
import { setContent } from "applesauce-core/operations/content";
import {
  addAddressPointerTag,
  addEventPointerTag,
  addProfilePointerTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";

/** Sets the cashu proofs for a nutzap event */
export function setProofs(proofs: Proof[]): EventOperation {
  // Create an operation to append proof tags
  const operation: TagOperation = (tags) => [...tags, ...proofs.map((proof) => ["proof", JSON.stringify(proof)])];

  return modifyPublicTags(operation);
}

/** Sets the mint URL for a nutzap event */
export function setMint(mint: string): EventOperation {
  return modifyPublicTags(setSingletonTag(["u", mint]));
}

/** Sets the recipient of a nutzap event */
export function setRecipient(recipient: string | ProfilePointer): EventOperation {
  return modifyPublicTags(addProfilePointerTag(recipient, true));
}

/** Sets the event that is being nutzapped */
export function setEvent(event: EventPointer | AddressPointer | NostrEvent): EventOperation {
  let operation: TagOperation;

  if (isEvent(event))
    operation = isReplaceable(event.kind)
      ? addEventPointerTag(event.id)
      : addAddressPointerTag(getReplaceableAddress(event));
  else if (isAddressPointer(event)) operation = addAddressPointerTag(event);
  else operation = addEventPointerTag(event);

  return modifyPublicTags(operation);
}

/** Sets the comment content for a nutzap event */
export function setComment(comment: string): EventOperation {
  return setContent(comment);
}
