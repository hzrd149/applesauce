import type { EventOperation } from "../factories/types.js";
import { kinds } from "../helpers/event.js";
import { AddressPointer, getReplaceableAddressFromPointer } from "../helpers/pointers.js";
import { fillAndTrimTag } from "../helpers/tags.js";
import { includeSingletonTag } from "./tags.js";

// A list of event kinds to never attach the "client" tag to
const NEVER_ATTACH_CLIENT_TAG = [kinds.EncryptedDirectMessage, kinds.GiftWrap, kinds.Seal, kinds.PrivateDirectMessage];

/** Includes a NIP-89 client tag in an event*/
export function setClient(
  name: string,
  pointer?: Omit<AddressPointer, "kind" | "relays">,
  replace = true,
): EventOperation {
  return (draft) => {
    if (NEVER_ATTACH_CLIENT_TAG.includes(draft.kind)) return draft;
    else {
      const coordinate = pointer
        ? getReplaceableAddressFromPointer({
            pubkey: pointer.pubkey,
            identifier: pointer.identifier,
            kind: kinds.Handlerinformation,
          })
        : undefined;

      return includeSingletonTag(fillAndTrimTag(["client", name, coordinate]) as [string, ...string[]], replace)(draft);
    }
  };
}
