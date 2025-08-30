import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import {
  decodeGroupPointer,
  getDisplayName,
  getProfilePicture,
  getSeenRelays,
  groupMessageEvents,
  GroupPointer,
  mergeRelaySets,
  ProfileContent,
} from "applesauce-core/helpers";
import { EventFactory } from "applesauce-factory";
import { GroupMessageBlueprint } from "applesauce-factory/blueprints";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { useObservableMemo } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { NostrEvent } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";
import { useCallback, useEffect, useState } from "react";
import { map, startWith } from "rxjs";

import GroupPicker from "../../components/group-picker";

const eventStore = new EventStore();
const signer = new ExtensionSigner();
const factory = new EventFactory({
  signer,
});

const pool = new RelayPool();

const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: ["wss://purplepag.es/"],
});

// Add loaders to event store
// These will be called if the event store doesn't have the requested event
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

/** Create a hook for loading a users profile */
function useProfile(user: ProfilePointer): ProfileContent | undefined {
  return useObservableMemo(() => eventStore.profile(user), [user.pubkey, user.relays?.join("|")]);
}

function ChatMessageGroup({ messages }: { messages: NostrEvent[] }) {
  const profile = useProfile({ pubkey: messages[0].pubkey, relays: mergeRelaySets(getSeenRelays(messages[0])) });

  const time = messages[0].created_at;

  return (
    <div className="chat chat-start">
      <div className="chat-image avatar">
        <div className="w-10 rounded-full">
          <img
            alt={getDisplayName(profile)}
            src={getProfilePicture(profile, `https://robohash.org/${messages[0].pubkey}`)}
          />
        </div>
      </div>
      <div className="chat-header">
        {getDisplayName(profile)}
        <time className="text-xs opacity-50">{new Date(time * 1000).toLocaleString()}</time>
      </div>
      <div className="flex flex-col gap-2">
        {messages.map((message) => (
          <div className="chat-bubble">{message.content}</div>
        ))}
      </div>
    </div>
  );
}

function ChatLog({ pointer }: { pointer: GroupPointer }) {
  const messages = useObservableMemo(
    () =>
      pool
        .relay(pointer.relay)
        .subscription({ kinds: [9], "#h": [pointer.id], limit: 100 })
        .pipe(
          onlyEvents(),
          mapEventsToStore(eventStore),
          mapEventsToTimeline(),
          map((t) => [...t]),
          startWith([]),
        ),
    [pointer.relay, pointer?.id],
  );

  const groups = groupMessageEvents(messages ? Array.from(messages).reverse() : []).reverse();

  return (
    <div
      className="flex gap-2 flex-col-reverse overflow-y-auto overflow-x-hidden border p-4 border-base-300 rounded-lg"
      style={{ height: "calc(100vh - 12rem - 4rem)" }}
    >
      {groups.map((group) => (
        <ChatMessageGroup key={group[0].id} messages={group} />
      ))}
    </div>
  );
}

function SendMessageForm({ pointer }: { pointer: GroupPointer }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  // Clear the message when the pointer changes
  useEffect(() => setMessage(""), [pointer]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim() || !pointer) return;

    setSending(true);
    try {
      // Create a draft for a group message
      const draft = await factory.create(GroupMessageBlueprint, pointer, message);
      // Sign the draft
      const signed = await factory.sign(draft);
      // Publish the message to the relay
      const response = await pool.relay(pointer.relay).publish(signed);
      // Throw an error if the message was rejected
      if (!response.ok) throw new Error(response.message);
      // Clear the form
      setMessage("");
    } catch (err) {
      if (err instanceof Error) alert(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-4">
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={sending}
        placeholder="Type your message..."
        className="input input-bordered flex-grow"
      />
      <button type="submit" disabled={sending || !message.trim()} className="btn btn-primary">
        {sending ? <span className="loading loading-spinner loading-sm"></span> : "Send"}
      </button>
    </form>
  );
}

export default function RelayGroupExample() {
  const [identifier, setIdentifier] = useState("");
  const [pointer, setPointer] = useState<GroupPointer>();

  const setGroup = useCallback(
    (identifier: string) => {
      try {
        setIdentifier(identifier);
        setPointer(decodeGroupPointer(identifier));
      } catch (error) {}
    },
    [setIdentifier, setPointer],
  );

  return (
    <div className="container mx-auto p-2 h-full overflow-hidden">
      <div className="flex w-full max-w-xl mb-4">
        <GroupPicker identifier={identifier} setIdentifier={setGroup} />
      </div>

      {pointer && <ChatLog pointer={pointer} />}
      {pointer && <SendMessageForm pointer={pointer} />}
    </div>
  );
}
