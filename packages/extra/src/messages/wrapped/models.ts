import {
  getConversationIdentifierFromMessage,
  getConversationParticipants,
  getWrappedMessageParent,
  isWrappedMessage,
} from "applesauce-common/helpers";
import type { Model } from "applesauce-core/event-store";
import { kinds, type Rumor } from "applesauce-core/helpers";
import { map } from "rxjs";

/** Selects deduplicated chat and file rumors belonging to the account */
export function selectWrappedMessages(rumors: Rumor[], pubkey: string): Rumor[] {
  const messages = rumors.filter(
    (rumor) => isWrappedMessage(rumor) && getConversationParticipants(rumor).includes(pubkey),
  );
  return [...new Map(messages.map((message) => [message.id, message])).values()].sort(
    (a, b) => b.created_at - a.created_at,
  );
}

/** Groups messages by participant set and selects the latest message in each conversation */
export function groupWrappedMessages(messages: Rumor[]) {
  const groups = new Map<string, Rumor>();
  for (const message of messages) {
    const id = getConversationIdentifierFromMessage(message);
    const previous = groups.get(id);
    if (!previous || previous.created_at < message.created_at) groups.set(id, message);
  }
  return [...groups].map(([id, lastMessage]) => ({
    id,
    participants: getConversationParticipants(lastMessage),
    lastMessage,
  }));
}

/** Returns the chat and file message timeline from a conversation rumor store */
export function ConversationMessagesModel(): Model<Rumor[], Rumor> {
  return (store) =>
    store
      .timeline({ kinds: [kinds.PrivateDirectMessage, kinds.FileMessage] })
      .pipe(map((messages) => messages.filter(isWrappedMessage)));
}

/** Returns root messages with replies from a conversation rumor store */
export function ConversationThreadsModel(): Model<Rumor[], Rumor> {
  return (store) =>
    store.model(ConversationMessagesModel).pipe(
      map((messages) => {
        const parents = new Set(messages.map(getWrappedMessageParent).filter(Boolean));
        return messages.filter((message) => !getWrappedMessageParent(message) && parents.has(message.id));
      }),
    );
}

/** Returns direct replies to a message from a conversation rumor store */
export function ConversationRepliesModel(parent: string): Model<Rumor[], Rumor> {
  return (store) =>
    store
      .model(ConversationMessagesModel)
      .pipe(map((messages) => messages.filter((message) => getWrappedMessageParent(message) === parent)));
}
