import { EventOperation } from "applesauce-core/factories";
import { isReplaceable, NostrEvent, ProfilePointer, skip, tagPipe } from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import {
  addAddressPointerTag,
  addEventPointerTag,
  addProfilePointerTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { includeSingletonTag } from "applesauce-core/operations/tags";

/** Sets the relays tag on a zap request */
export function setRelays(relays: string[]): EventOperation {
  return includeSingletonTag(["relays", ...relays], true);
}

/** Sets the amount in millisatoshis on a zap request */
export function setAmount(amount: number): EventOperation {
  return includeSingletonTag(["amount", amount.toString()], true);
}

/** Sets the lnurl tag (bech32-encoded) on a zap request */
export function setLnurl(lnurl: string): EventOperation {
  return includeSingletonTag(["lnurl", lnurl], true);
}

/**
 * Sets the event target on an event zap request.
 * Sets the k tag (kind), a tag (coordinate for replaceable/addressable events),
 * e tag (event id), and p tag (recipient pubkey).
 * @param event - The NostrEvent being zapped
 * @param hint - Optional relay hint for the event
 */
export function setEventTarget(event: NostrEvent, hint?: string): EventOperation {
  return modifyPublicTags(
    tagPipe(
      setSingletonTag(["k", String(event.kind)], true),
      // Include the "e" tag for the event id
      addEventPointerTag(event, hint, true),
      // Include the "a" tag only for replaceable/addressable events
      isReplaceable(event.kind) ? addAddressPointerTag(event, hint, true) : skip(),
      // Include the "p" tag for the event author (recipient)
      addProfilePointerTag({ pubkey: event.pubkey }, hint, true),
    ),
  );
}

/**
 * Sets the profile target on a profile zap request. Sets the p tag (recipient)
 * @param pubkey - Pubkey string or ProfilePointer
 * @param hint - Optional relay hint
 */
export function setProfileTarget(pubkey: string | ProfilePointer, hint?: string): EventOperation {
  return modifyPublicTags(addProfilePointerTag(pubkey, hint, true));
}
