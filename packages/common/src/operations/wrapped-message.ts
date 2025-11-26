import { EventOperation } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import { eventPipe } from "applesauce-core/helpers/pipeline";
import { includeNameValueTag } from "applesauce-core/operations/tags";
import { Rumor } from "../helpers/gift-wraps.js";
import { getConversationParticipants } from "../helpers/messages.js";

/**
 * Sets the nessiary "p" tags for a wrapped message
 * @param participants - The conversation identifier (pubkey1:pubkey2:pubkey3), a users pubkey, or a list of participant pubkeys
 * @param self - The public key of the sender
 */
export function setConversation(participants: string | string[], self: string): EventOperation {
  const keys = new Set(typeof participants === "string" ? getConversationParticipants(participants) : participants);

  // NOTE: do not include the sender in the message. their pubkey will be attached to the message in "pubkey"
  keys.delete(self);

  // TODO: support relay hints
  return eventPipe(...Array.from(keys).map((key) => includeNameValueTag(["p", key])));
}

/** Sets the subject of a wrapped message */
export function setSubject(subject: string): EventOperation {
  return includeNameValueTag(["subject", subject]);
}

/** Makes the wrapped message a reply to the parent message */
export function setParent(parent: Rumor | string): EventOperation {
  if (typeof parent !== "string" && parent.kind !== kinds.PrivateDirectMessage)
    throw new Error("Parent must be a private direct message event");

  const id = typeof parent === "string" ? parent : parent.id;
  // TODO: support relay hints
  return includeNameValueTag(["e", id]);
}
