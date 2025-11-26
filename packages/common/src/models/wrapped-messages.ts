import { Model } from "applesauce-core/event-store";
import { watchEventsUpdates } from "applesauce-core/observable";
import { kinds } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { getGiftWrapRumor, Rumor } from "../helpers/gift-wrap.js";
import {
  createConversationIdentifier,
  getConversationIdentifierFromMessage,
  getConversationParticipants,
} from "../helpers/messages.js";
import { getWrappedMessageParent } from "../helpers/wrapped-messages.js";

/**
 * A model that returns all wrapped messages for a pubkey
 * @param self - The pubkey of the user
 */
export function WrappedMessagesModel(self: string): Model<Rumor[]> {
  return (store) =>
    store.timeline({ kinds: [kinds.GiftWrap], "#p": [self] }).pipe(
      // Watch for updates to the gift wraps
      watchEventsUpdates(store),
      // Get rumors and filter out locked
      map((rumors) =>
        rumors
          .map((gift) => getGiftWrapRumor(gift))
          .filter((e) => !!e)
          .filter((e) => e.kind === kinds.PrivateDirectMessage)
          .sort((a, b) => b.created_at - a.created_at),
      ),
    );
}

/** A model that returns all conversations that a pubkey is participating in */
export function WrappedMessagesGroups(
  self: string,
): Model<{ id: string; participants: string[]; lastMessage: Rumor }[]> {
  return (store) =>
    store.model(WrappedMessagesModel, self).pipe(
      map((messages) => {
        const groups: Record<string, Rumor> = {};
        for (const message of messages) {
          const id = getConversationIdentifierFromMessage(message);
          if (!groups[id] || groups[id].created_at < message.created_at) groups[id] = message;
        }

        return Object.values(groups).map((message) => ({
          id: getConversationIdentifierFromMessage(message),
          participants: getConversationParticipants(message),
          lastMessage: message,
        }));
      }),
    );
}

/**
 * A model that returns all wrapped direct messages in a conversation
 * @param self - The pubkey of the user
 * @param participants - A conversation identifier or a list of participant pubkeys
 */
export function WrappedMessagesGroup(self: string, participants: string | string[]): Model<Rumor[]> {
  // Get the conversation identifier include the users pubkey
  const identifier = createConversationIdentifier(self, participants);

  return (store) =>
    store.model(WrappedMessagesModel, self).pipe(
      // Only select direct messages for this conversation
      map((rumors) =>
        rumors.filter(
          (rumor) =>
            rumor.kind === kinds.PrivateDirectMessage &&
            // Only select message for this conversation (the identifier from the message will include "self")
            getConversationIdentifierFromMessage(rumor) === identifier,
        ),
      ),
    );
}

/**
 * Returns an array of root wrapped messages that have replies
 * @param self - The pubkey of the user
 * @param participants - A conversation identifier or a list of participant pubkeys
 */
export function WrappedMessageThreads(self: string, participants: string | string[]): Model<Rumor[]> {
  return (store) =>
    store.model(WrappedMessagesGroup, self, participants).pipe(
      // Filter down messages to only include root messages that have replies
      map((rumors) =>
        rumors.filter(
          (rumor) =>
            // Only select root messages
            !getWrappedMessageParent(rumor) &&
            // Check if message has any replies
            rumors.some((r) => getWrappedMessageParent(r) === rumor.id),
        ),
      ),
    );
}

/**
 * A model that returns all the gift wrapped direct messages that are replies to a given message
 * @param self - The pubkey of the user
 * @param message - The message to get the replies for
 */
export function WrappedMessageReplies(self: string, message: Rumor): Model<Rumor[]> {
  const conversation = getConversationIdentifierFromMessage(message);

  return (store) =>
    store.model(WrappedMessagesGroup, self, conversation).pipe(
      // Only select replies to this message
      map((rumors) => rumors.filter((rumor) => getWrappedMessageParent(rumor) === message.id)),
    );
}
