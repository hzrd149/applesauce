import { EventOperation } from "applesauce-core/event-factory";
import { includeNameValueTag } from "applesauce-core/operations/tags";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";

/** Includes the nip-04 direct message "p" tag */
export function setMessageAddress(pubkey: string): EventOperation {
  return includeNameValueTag(["p", pubkey]);
}

/** Includes the "e" tag for legacy message replies */
export function setMessageParent(parent: string | NostrEvent): EventOperation {
  if (typeof parent !== "string" && parent.kind !== kinds.EncryptedDirectMessage)
    throw new Error("Legacy messages can only reply to other legacy messages");
  const id = typeof parent === "string" ? parent : parent.id;
  return includeNameValueTag(["e", id]);
}
