import { EventOperation } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import {
  addAddressPointerTag,
  addProfilePointerTag,
  removeProfilePointerTag,
} from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";

type RelayHint = string | ((value: string) => Promise<string | undefined>);

const removeAddressTags = (tags: string[][]) => tags.filter((tag) => tag[0] !== "a");
const removeProfileTags = (tags: string[][]) => tags.filter((tag) => tag[0] !== "p");

/** Replaces the badge definition pointer referenced by the award */
export function setBadgePointer(address: string | AddressPointer | NostrEvent, relayHint?: RelayHint): EventOperation {
  return modifyPublicTags(removeAddressTags, addAddressPointerTag(address, relayHint, true));
}

/** Removes the badge definition pointer */
export function clearBadgePointer(): EventOperation {
  return modifyPublicTags(removeAddressTags);
}

/** Replaces all recipients with the provided list */
export function setRecipients(recipients: Array<string | ProfilePointer>): EventOperation {
  const operations = recipients.map((recipient) =>
    addProfilePointerTag(recipient, typeof recipient === "string" ? undefined : recipient.relays?.[0], true),
  );
  return modifyPublicTags(removeProfileTags, ...operations);
}

/** Adds or replaces a single recipient */
export function addRecipient(recipient: string | ProfilePointer, relayHint?: RelayHint): EventOperation {
  const hint = relayHint || typeof recipient === "string" ? undefined : recipient.relays?.[0];
  return modifyPublicTags(addProfilePointerTag(recipient, hint, true));
}

/** Removes a specific recipient */
export function removeRecipient(recipient: string | ProfilePointer): EventOperation {
  return modifyPublicTags(removeProfilePointerTag(recipient));
}

/** Removes every recipient */
export function clearRecipients(): EventOperation {
  return modifyPublicTags(removeProfileTags);
}
