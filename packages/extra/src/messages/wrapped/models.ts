import { getWrappedMessageParent } from "applesauce-common/helpers";
import type { Model } from "applesauce-core/event-store";
import { kinds, type Rumor } from "applesauce-core/helpers";
import { map } from "rxjs";

/** Returns the kind-14 timeline from a conversation rumor store */
export function ConversationMessagesModel(): Model<Rumor[], Rumor> {
  return (store) => store.timeline({ kinds: [kinds.PrivateDirectMessage] });
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
