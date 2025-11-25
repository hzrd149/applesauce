import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { Rumor } from "applesauce-core/helpers/gift-wraps";
import { isPTag } from "applesauce-core/helpers/tags";

/**
 * Groups messages into bubble sets based on the pubkey and time
 *
 * @param messages - The messages to group
 * @param buffer - Minimum number of seconds between message groups
 * @returns The grouped messages
 */
export function groupMessageEvents<T extends { created_at: number; pubkey: string }>(
  messages: T[],
  buffer = 5 * 60,
): T[][] {
  const groups: T[][] = [];

  for (const message of messages) {
    const group = groups[groups.length - 1];
    const last = group?.[0];

    if (group && last?.pubkey === message.pubkey && Math.abs(message.created_at - last.created_at) < buffer)
      group.push(message);
    else groups.push([message]);
  }

  return groups;
}

/**
 * Returns all pubkeys of participants of a conversation
 * @param participants - A conversation identifier (pubkey1:pubkey2:pubkey3), or a users pubkey, or a list of participant pubkeys, or a rumor message
 * @returns The participants of the conversation
 */
export function getConversationParticipants(participants: string | string[] | Rumor | NostrEvent): string[] {
  let participantList: string[];

  if (typeof participants === "string") {
    participantList = participants.split(":");
  } else if (Array.isArray(participants)) {
    participantList = participants;
  } else {
    if (participants.kind !== kinds.EncryptedDirectMessage && participants.kind !== kinds.PrivateDirectMessage)
      throw new Error("Can only get participants from direct message event (4, 14)");

    participantList = [participants.pubkey, ...participants.tags.filter(isPTag).map((t) => t[1])];
  }

  return Array.from(new Set(participantList));
}

/**
 * Creates a conversation identifier from a users pubkey and alist of correspondants
 * @param participants - The participants of the conversation
 * @returns The conversation identifier
 */
export function createConversationIdentifier(...participants: (string | string[])[]): string {
  return Array.from(new Set(participants.flat())).sort().join(":");
}

/**
 * Returns the conversation identifier for a wrapped direct message
 * @param message - The NIP-17 Rumor or NIP-04 message event
 * @returns The conversation identifier
 */
export function getConversationIdentifierFromMessage(message: Rumor | NostrEvent): string {
  return createConversationIdentifier(getConversationParticipants(message));
}
