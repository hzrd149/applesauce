import { Rumor } from "./gift-wraps.js";
import { getConversationParticipants, getTagValue } from "./index.js";

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
