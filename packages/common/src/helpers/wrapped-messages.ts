import { getTagValue, kinds } from "applesauce-core/helpers/event";
import { isValidFileMessage } from "./file-message.js";
import { Rumor } from "./gift-wrap.js";
import { getConversationParticipants } from "./messages.js";

/** Checks if a rumor is a NIP-17 chat message (kind 14) or a valid file message (kind 15) */
export function isWrappedMessage(rumor: Rumor): boolean {
  return rumor.kind === kinds.PrivateDirectMessage || isValidFileMessage(rumor);
}

/** Returns the subject of a wrapped direct message */
export function getWrappedMessageSubject(message: Rumor): string | undefined {
  return getTagValue(message, "subject");
}

/** Returns the parent id of a wrapped direct message */
export function getWrappedMessageParent(message: Rumor): string | undefined {
  return getTagValue(message, "e");
}

/** Returns the sender of a wrapped direct message */
export function getWrappedMessageSender(message: Rumor): string {
  return message.pubkey;
}

/** @deprecated use {@link getWrappedMessageSender} instead */
export const getWrappedMesssageSender = getWrappedMessageSender;

/**
 * Returns the first participant in a conversation that is not the sender
 * @see getConversationParticipants
 */
export function getWrappedMessageReceiver(message: Rumor): string {
  return getConversationParticipants(message).filter((p) => p !== message.pubkey)[0];
}
