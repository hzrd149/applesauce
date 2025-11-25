import { Proof } from "@cashu/cashu-ts";
import { getReplaceableAddress, isAddressPointer, isEvent, isReplaceable } from "applesauce-core/helpers";
import { EventOperation, TagOperation } from "applesauce-factory";
import { modifyPublicTags } from "applesauce-factory/operations";
import { setContent } from "applesauce-factory/operations/content";
import { addAddressTag, addEventTag, addPubkeyTag, setSingletonTag } from "applesauce-factory/operations/tag";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, EventPointer, ProfilePointer } from "nostr-tools/nip19";

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
  return modifyPublicTags(addPubkeyTag(recipient, true));
}

/** Sets the event that is being nutzapped */
export function setEvent(event: EventPointer | AddressPointer | NostrEvent): EventOperation {
  let operation: TagOperation;

  if (isEvent(event))
    operation = isReplaceable(event.kind) ? addEventTag(event.id) : addAddressTag(getReplaceableAddress(event));
  else if (isAddressPointer(event)) operation = addAddressTag(event);
  else operation = addEventTag(event);

  return modifyPublicTags(operation);
}

/** Sets the comment content for a nutzap event */
export function setComment(comment: string): EventOperation {
  return setContent(comment);
}
