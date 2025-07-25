import { AddressPointer } from "nostr-tools/nip19";
import { getCoordinateFromAddressPointer } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";

import { includeSingletonTag } from "./tags.js";
import { fillAndTrimTag } from "../helpers/tag.js";
import { EventOperation } from "../types.js";

// A list of event kinds to never attach the "client" tag to
const NEVER_ATTACH_CLIENT_TAG = [kinds.EncryptedDirectMessage, kinds.GiftWrap, kinds.Seal];

/** Includes a NIP-89 client tag in an event*/
export function setClient(
  name: string,
  pointer?: Omit<AddressPointer, "kind" | "relays">,
  replace = true,
): EventOperation {
  return (draft, ctx) => {
    if (NEVER_ATTACH_CLIENT_TAG.includes(draft.kind)) return draft;
    else {
      const coordinate = pointer
        ? getCoordinateFromAddressPointer({
            pubkey: pointer.pubkey,
            identifier: pointer.identifier,
            kind: kinds.Handlerinformation,
          })
        : undefined;

      return includeSingletonTag(fillAndTrimTag(["client", name, coordinate]) as [string, ...string[]], replace)(
        draft,
        ctx,
      );
    }
  };
}
