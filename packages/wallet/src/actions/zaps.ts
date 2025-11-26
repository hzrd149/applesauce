import { Token } from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { NostrEvent } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { NutzapBlueprint, ProfileNutzapBlueprint } from "../blueprints/zaps.js";
import { NUTZAP_INFO_KIND, verifyProofsLocked } from "../helpers/zap-info.js";

/** Creates a NIP-61 nutzap event for an event with a token */
export function NutzapEvent(event: NostrEvent, token: Token, comment?: string): Action {
  return async function* ({ events, factory }) {
    const recipient = event.pubkey;
    const info = events.getReplaceable(NUTZAP_INFO_KIND, recipient);
    if (!info) throw new Error("Nutzap info not found");

    // Verify all tokens are p2pk locked
    verifyProofsLocked(token.proofs, info);

    // NOTE: Disabled because mints and units should be checked by the app before
    // const mints = getNutzapInfoMints(info);
    // if (!mints.some((m) => m.mint === token.mint)) throw new Error("Token mint not found in nutzap info");

    const nutzap = await factory.sign(await factory.create(NutzapBlueprint, event, token, comment || token.memo));
    yield nutzap;
  };
}

/** Creates a NIP-61 nutzap event to a users profile */
export function NutzapProfile(user: string | ProfilePointer, token: Token, comment?: string): Action {
  return async function* ({ events, factory }) {
    const info = events.getReplaceable(NUTZAP_INFO_KIND, typeof user === "string" ? user : user.pubkey);
    if (!info) throw new Error("Nutzap info not found");

    // Verify all tokens are p2pk locked
    verifyProofsLocked(token.proofs, info);

    const nutzap = await factory.sign(await factory.create(ProfileNutzapBlueprint, user, token, comment || token.memo));
    yield nutzap;
  };
}
