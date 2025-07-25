import { kinds, NostrEvent } from "nostr-tools";
import { EventOperation } from "../types.js";
import { includeNameValueTag } from "./tags.js";

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
