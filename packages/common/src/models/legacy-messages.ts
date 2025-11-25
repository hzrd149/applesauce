import { Model } from "applesauce-core/event-store";
import { NostrEvent, kinds } from "applesauce-core/helpers/event";
import { hasNameValueTag } from "applesauce-core/helpers/event-tags";
import { map } from "rxjs";

import { getLegacyMessageCorrespondent, getLegacyMessageParent } from "../helpers/legacy-messages.js";
import { getConversationIdentifierFromMessage, getConversationParticipants } from "../helpers/messages.js";

/** A model that returns all legacy message groups (1-1) that a pubkey is participating in */
export function LegacyMessagesGroups(
  self: string,
): Model<{ id: string; participants: string[]; lastMessage: NostrEvent }[]> {
  return (store) =>
    store.timeline({ kinds: [kinds.EncryptedDirectMessage], "#p": [self] }).pipe(
      map((messages) => {
        const groups: Record<string, NostrEvent> = {};
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

/** Returns all legacy direct messages in a group */
export function LegacyMessagesGroup(self: string, correspondent: string): Model<NostrEvent[]> {
  return (store) =>
    store.timeline([
      {
        kinds: [kinds.EncryptedDirectMessage],
        "#p": [self],
        authors: [correspondent],
      },
      {
        kinds: [kinds.EncryptedDirectMessage],
        "#p": [correspondent],
        authors: [self],
      },
    ]);
}

/** Returns an array of legacy messages that have replies */
export function LegacyMessageThreads(self: string, correspondent: string): Model<NostrEvent[]> {
  return (store) =>
    store.model(LegacyMessagesGroup, self, correspondent).pipe(
      map((messages) =>
        messages.filter(
          (message) =>
            // Only select messages that are not replies
            !getLegacyMessageParent(message) &&
            // Check if message has any replies
            messages.some((m) => hasNameValueTag(m, "e", message.id)),
        ),
      ),
    );
}

/** Returns all the legacy direct messages that are replies to a given message */
export function LegacyMessageReplies(self: string, message: NostrEvent): Model<NostrEvent[]> {
  const correspondent = getLegacyMessageCorrespondent(message, self);
  if (!correspondent) throw new Error("Legacy message has no correspondent");

  return (store) =>
    store.timeline([
      {
        kinds: [kinds.EncryptedDirectMessage],
        "#p": [self],
        authors: [correspondent],
        "#e": [message.id],
      },
      {
        kinds: [kinds.EncryptedDirectMessage],
        "#p": [correspondent],
        authors: [self],
        "#e": [message.id],
      },
    ]);
}
