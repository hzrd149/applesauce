import { Token } from "@cashu/cashu-ts";
import { blueprint, EventBlueprint } from "applesauce-factory";
import { skip } from "applesauce-factory/helpers";
import { NostrEvent } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";

import { NUTZAP_KIND } from "../helpers/nutzap.js";
import { setComment, setEvent, setMint, setProofs, setRecipient } from "../operations/nutzap.js";

/** A blueprint to create a NIP-61 nutzap event for an event */
export function NutzapBlueprint(event: NostrEvent, token: Token, comment?: string): EventBlueprint {
  return blueprint(
    NUTZAP_KIND,
    setProofs(token.proofs),
    setMint(token.mint),
    setEvent(event),
    setRecipient(event.pubkey),
    comment ? setComment(comment) : skip(),
  );
}

/** A blueprint to create a NIP-61 nutzap event for a user instead of an event */
export function ProfileNutzapBlueprint(user: string | ProfilePointer, token: Token, comment?: string): EventBlueprint {
  return blueprint(
    NUTZAP_KIND,
    setProofs(token.proofs),
    setMint(token.mint),
    setRecipient(user),
    comment ? setComment(comment) : skip(),
  );
}
