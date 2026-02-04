/**
 * Send and receive encrypted gift-wrapped direct messages
 * @tags messages, gift-wrap, encryption, dm
 * @related messages/legacy, gift-wrap/timeline
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { SendWrappedMessage } from "applesauce-actions/actions";
import {
  getConversationIdentifierFromMessage,
  getConversationParticipants,
  getGiftWrapRumor,
  getGiftWrapSeal,
  groupMessageEvents,
  persistEncryptedContent,
  Rumor,
  unlockGiftWrap,
} from "applesauce-common/helpers";
import { GiftWrapsModel, WrappedMessagesGroup, WrappedMessagesModel } from "applesauce-common/models";
import { defined, EventFactory, EventStore, mapEventsToStore } from "applesauce-core";
import { persistEventsToCache, unixNow } from "applesauce-core/helpers";
import { CacheRequest } from "applesauce-loaders";
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { kinds, NostrEvent } from "nostr-tools";
import { npubEncode } from "nostr-tools/nip19";
import { useEffect, useMemo, useRef, useState } from "react";
import { BehaviorSubject, map } from "rxjs";

// Import helper components
import LoginView from "../../components/login-view";
import RelayPicker from "../../components/relay-picker";
import UnlockView from "../../components/unlock-view";

import SecureStorage from "../../extra/encrypted-storage";

const EXPIRATIONS: Record<string, number> = {
  "30m": 60 * 30,
  "1d": 60 * 60 * 24,
  "1w": 60 * 60 * 24 * 7,
  "2w": 60 * 60 * 24 * 14,
  "1y": 60 * 60 * 24 * 365,
};

const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const signer$ = new BehaviorSubject<ExtensionSigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const eventStore = new EventStore();
const pool = new RelayPool();
const factory = new EventFactory({ signer: new ProxySigner(signer$.pipe(defined())) });
const actions = new ActionRunner(eventStore, factory);

// Persist encrypted content
persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Setup a local event cache
const cache = await openDB();
const cacheRequest: CacheRequest = (filters) => getEventsForFilters(cache, filters);

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

// Debug modal
const debug$ = new BehaviorSubject<NostrEvent | null>(null);

function MessageForm({ conversation, relay }: { conversation: string; relay: string }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [expiration, setExpiration] = useState<string>();

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    try {
      setSending(true);

      // Create and send gift wrapped message to all participants
      await actions
        .exec(SendWrappedMessage, getConversationParticipants(conversation), message.trim(), {
          expiration: expiration ? unixNow() + EXPIRATIONS[expiration] : undefined,
        })
        .forEach((gift) => pool.publish([relay], gift));

      setMessage("");
    } catch (err) {
      console.error("Failed to send message:", err);
    } finally {
      setSending(false);
    }
  };

  const toggleExpiration = () => {
    const arr = Object.keys(EXPIRATIONS);
    const next = expiration ? arr[arr.indexOf(expiration) + 1] : arr[0];
    setExpiration(next);
  };

  return (
    <form onSubmit={handleSend} className="flex gap-2 w-full">
      <input
        type="text"
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        disabled={sending}
        placeholder="Type your message..."
        className="input input-bordered flex-grow"
      />
      <button type="button" className="btn btn-ghost" title="Set expiration" onClick={toggleExpiration}>
        {expiration ? expiration : "--"}
      </button>
      <button type="submit" className="btn btn-primary" disabled={sending}>
        Send
      </button>
    </form>
  );
}

function MessageGroup({ messages, pubkey }: { messages: Rumor[]; pubkey: string }) {
  const isOwn = messages[0].pubkey === pubkey;
  const time = messages[0].created_at;

  return (
    <div className={`chat ${isOwn ? "chat-end" : "chat-start"}`}>
      <div className="chat-image avatar">
        <div className="w-10 rounded-full">
          <img src={`https://robohash.org/${messages[0].pubkey}`} />
        </div>
      </div>
      <div className="chat-header">{npubEncode(messages[0].pubkey).slice(0, 8)}...</div>
      <div className={`flex flex-col-reverse gap-2 overflow-hidden ${isOwn ? "items-end" : "items-start"}`}>
        {messages.map((message) => (
          <div key={message.id} className="chat-bubble whitespace-pre-line">
            {message.content}{" "}
            <a
              href="#"
              className="text-xs text-base-content/50"
              onClick={(e) => {
                e.preventDefault();
                const gift = eventStore
                  .getTimeline({ kinds: [kinds.GiftWrap] })
                  .find((gift) => getGiftWrapRumor(gift)?.id === message.id);
                if (gift) debug$.next(gift);
              }}
            >
              raw
            </a>
          </div>
        ))}
      </div>
      <div className="chat-footer opacity-50">
        <time className="text-xs">{new Date(time * 1000).toLocaleString()}</time>
      </div>
    </div>
  );
}

function ConversationView({ pubkey, conversation, relay }: { pubkey: string; conversation: string; relay: string }) {
  // Get all messages for this conversation
  const messages = use$(
    () =>
      eventStore
        .model(WrappedMessagesGroup, pubkey, getConversationParticipants(conversation))
        .pipe(map((t) => [...t])),
    [pubkey, conversation],
  );

  // Group the messages using the helper
  const messageGroups = useMemo(() => {
    if (!messages) return [];
    return groupMessageEvents(messages, 5 * 60); // 5 minute buffer between groups
  }, [messages]);

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden w-full">
      <div className="flex flex-col-reverse flex-1 overflow-y-auto overflow-x-hidden gap-4">
        {messageGroups.map((group) => (
          <MessageGroup key={group[0].id} messages={group} pubkey={pubkey} />
        ))}
      </div>

      <div className="flex items-center gap-2 w-full mt-4">
        <MessageForm conversation={conversation} relay={relay} />
      </div>
    </div>
  );
}

function ConversationList({
  messages,
  pubkey,
  onSelect,
  selected,
}: {
  messages: Rumor[];
  pubkey: string;
  onSelect: (id: string) => void;
  selected?: string;
}) {
  // Group messages by conversation and sort by latest message date
  const conversations = useMemo(() => {
    const convMap = new Map<string, { participants: string[]; lastMessage: Rumor }>();

    // Group messages by conversation
    for (const message of messages) {
      const convId = getConversationIdentifierFromMessage(message);
      const participants = getConversationParticipants(message);

      if (!convMap.has(convId) || convMap.get(convId)!.lastMessage.created_at < message.created_at) {
        convMap.set(convId, {
          participants,
          lastMessage: message,
        });
      }
    }

    // Convert to array and sort by latest message date
    return Array.from(convMap.entries()).sort((a, b) => b[1].lastMessage.created_at - a[1].lastMessage.created_at);
  }, [messages]);

  return (
    <ul className="list bg-base-100 rounded-box">
      {conversations.map(([convId, { participants, lastMessage }]) => (
        <li
          key={convId}
          className={`list-row cursor-pointer hover:bg-base-200 ${selected === convId ? "bg-base-200" : ""}`}
          onClick={() => onSelect(convId)}
        >
          <div className="avatar-group -space-x-4 rtl:space-x-reverse">
            {participants
              .filter((p) => p !== pubkey)
              .map((p) => (
                <div key={p} className="avatar">
                  <div className="w-8 h-8">
                    <img src={`https://robohash.org/${p}`} />
                  </div>
                </div>
              ))}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm">
              {participants
                .filter((p) => p !== pubkey)
                .map((p) => npubEncode(p).slice(0, 8))
                .join(", ")}
            </div>
            <div className="text-xs font-semibold opacity-50">
              {new Date(lastMessage.created_at * 1000).toLocaleString()}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function GiftWrapDebugModal({ gift }: { gift: NostrEvent }) {
  const rumor = useMemo(() => getGiftWrapRumor(gift), [gift]);
  const seal = useMemo(() => getGiftWrapSeal(gift), [gift]);

  return (
    <>
      <h3 className="text-lg font-bold">Rumor</h3>
      <pre>
        <code>{JSON.stringify(rumor, null, 2)}</code>
      </pre>
      <h3 className="text-lg font-bold">Seal</h3>
      <pre>
        <code>{JSON.stringify(seal, null, 2)}</code>
      </pre>
      <h3 className="text-lg font-bold">Gift wrap</h3>
      <pre>
        <code>{JSON.stringify(gift, null, 2)}</code>
      </pre>
    </>
  );
}

function HomeView({ pubkey }: { pubkey: string }) {
  const [relay, setRelay] = useState<string>("wss://relay.damus.io/");
  const [selectedConversation, setSelectedConversation] = useState<string>();
  const signer = use$(signer$);
  const debug = use$(debug$);

  // Create a loader that loads all gift wraps for a pubkey
  const timeline = useMemo(
    () =>
      createTimelineLoader(
        pool,
        [relay],
        { kinds: [kinds.GiftWrap], "#p": [pubkey] },
        { eventStore, cache: cacheRequest },
      ),
    [relay, pubkey],
  );

  // load the first page of events
  useEffect(() => {
    timeline().subscribe();
  }, [timeline]);

  // Create subscription for new events
  use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [kinds.GiftWrap], "#p": [pubkey] })
        .pipe(mapEventsToStore(eventStore)),
    [relay, pubkey],
  );

  // Select all unlocked gift wraps
  const messages = use$(() => eventStore.model(WrappedMessagesModel, pubkey), [pubkey]);

  const [decrypting, setDecrypting] = useState(false);
  const pending = use$(() => eventStore.model(GiftWrapsModel, pubkey, true).pipe(map((t) => [...t])), [pubkey]);
  const decryptPending = async () => {
    if (!pending || !signer) return;
    setDecrypting(true);
    for (const gift of pending) {
      try {
        await unlockGiftWrap(gift, signer);
      } catch (error) {
        // Ignore errors
      }
    }
    setDecrypting(false);
  };

  // Control the debug modal
  const modal = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!modal.current) return;
    if (debug && !modal.current.open) modal.current.showModal();
    else if (!debug && modal.current.open) modal.current.close();
  }, [debug]);

  return (
    <div className="flex bg-base-200 overflow-hidden h-screen">
      <div className="w-sm bg-base-100 p-2 overflow-y-auto flex flex-col gap-2 shrink-0">
        <RelayPicker className="w-full" value={relay} onChange={setRelay} />

        {pending && pending.length > 0 && (
          <button className="btn btn-primary mx-auto" onClick={decryptPending} disabled={decrypting}>
            {decrypting ? "Decrypting..." : `Decrypt pending (${pending.length})`}
          </button>
        )}

        {messages && (
          <ConversationList
            messages={[...messages]}
            pubkey={pubkey}
            onSelect={setSelectedConversation}
            selected={selectedConversation}
          />
        )}
        <button className="btn btn-primary mx-auto" onClick={() => timeline()}>
          Load more
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {selectedConversation ? (
          <ConversationView pubkey={pubkey} conversation={selectedConversation} relay={relay} />
        ) : (
          <div className="flex items-center justify-center h-full text-base-content/50">
            Select a conversation to start messaging
          </div>
        )}
      </div>

      {/* Gift wrap debug modal */}
      <dialog id="debug-modal" className="modal" ref={modal}>
        <div className="modal-box w-full max-w-6xl">{debug && <GiftWrapDebugModal gift={debug} />}</div>
        <form method="dialog" className="modal-backdrop">
          <button>close</button>
        </form>
      </dialog>
    </div>
  );
}

function App() {
  const storage = use$(storage$);
  const signer = use$(signer$);
  const pubkey = use$(pubkey$);

  const handleUnlock = async (storage: SecureStorage, pubkey?: string) => {
    storage$.next(storage);

    if (pubkey) {
      pubkey$.next(pubkey);
      signer$.next(new ExtensionSigner());
    }
  };

  const handleLogin = async (signer: ExtensionSigner, pubkey: string) => {
    signer$.next(signer);
    pubkey$.next(pubkey);
    if (storage) await storage.setItem("pubkey", pubkey);
  };

  // Show unlock view if storage is not initialized
  if (!storage) return <UnlockView onUnlock={handleUnlock} />;

  // Show login view if not logged in
  if (!signer || !pubkey) return <LoginView onLogin={handleLogin} />;

  // Show main inbox view when both storage and login are ready
  return <HomeView pubkey={pubkey} />;
}

export default App;
