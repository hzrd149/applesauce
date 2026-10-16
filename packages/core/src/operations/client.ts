import type { EventOperation } from "../factories/types.js";
import { kinds } from "../helpers/event.js";
import { AddressPointer, getReplaceableAddressFromPointer } from "../helpers/pointers.js";
import { isSafeRelayURL } from "../helpers/relays.js";
import { fillAndTrimTag } from "../helpers/tags.js";
import { normalizeURL } from "../helpers/url.js";
import { includeSingletonTag } from "./tags.js";

// A list of event kinds to never attach the "client" tag to
const NEVER_ATTACH_CLIENT_TAG = [kinds.EncryptedDirectMessage, kinds.GiftWrap, kinds.Seal, kinds.PrivateDirectMessage];

/** Includes a NIP-89 client tag in an event, with an optional handler address and relay hint */
export function setClient(name: string, pointer?: Omit<AddressPointer, "kind">, replace = true): EventOperation {
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
      const relay = coordinate ? pointer?.relays?.find(isSafeRelayURL) : undefined;

      return includeSingletonTag(
        fillAndTrimTag(["client", name, coordinate, relay && normalizeURL(relay)]) as [string, ...string[]],
        replace,
      )(draft);
    }
  };
}
