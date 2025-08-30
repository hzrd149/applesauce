import { ProxySigner } from "applesauce-accounts";
import { ActionHub } from "applesauce-actions";
import { SendLegacyMessage } from "applesauce-actions/actions";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import {
  getTagValue,
  isLegacyMessageLocked,
  lockEncryptedContent,
  persistEncryptedContent,
  persistEventsToCache,
  unixNow,
  unlockLegacyMessage,
} from "applesauce-core/helpers";
import { EncryptedContentModel } from "applesauce-core/models";
import { EventFactory } from "applesauce-factory";
import { CacheRequest } from "applesauce-loaders";
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { useObservableEagerMemo, useObservableMemo, useObservableState } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { ExtensionSigner } from "applesauce-signers";
import localforage from "localforage";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { Filter, kinds, NostrEvent } from "nostr-tools";
import { npubEncode } from "nostr-tools/nip19";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BehaviorSubject } from "rxjs";

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
const actions = new ActionHub(eventStore, factory);

// Persist encrypted content
persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Setup a local event cache
const cache = await openDB();
const cacheRequest: CacheRequest = (filters) => getEventsForFilters(cache, filters);

// Save all new events to the cache
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

function ContactList({
  events,
  pubkey,
  onSelect,
}: {
  events: NostrEvent[];
  pubkey: string;
  onSelect: (pubkey: string) => void;
}) {
  const contacts = useMemo(() => {
    return events
      .filter((e) => e.kind === 4)
      .map((event) => {
        const sender = event.pubkey;
        const recipient = getTagValue(event, "p");
        if (recipient === pubkey) return sender;
        else if (sender === pubkey) return recipient;
        else return undefined;
      })
      .filter((p) => p !== undefined)
      .reduce((arr, p) => {
        if (arr.includes(p)) return arr;
        else return [...arr, p];
      }, [] as string[]);
  }, [events, pubkey]);

  return (
    <ul className="list bg-base-100 rounded-box">
      {contacts.map((contactPubkey) => (
        <li key={contactPubkey} className="list-row">
          <div>
            <img className="size-10 rounded-box" src={`https://robohash.org/${contactPubkey}.png`} />
          </div>
          <div>
            <div>{contactPubkey.slice(0, 8)}...</div>
            <div className="text-xs font-semibold opacity-60 break-all">{npubEncode(contactPubkey)}</div>
          </div>
          <button className="btn btn-square btn-ghost" onClick={() => onSelect(contactPubkey)}>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="size-6"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 0 1-.825-.242m9.345-8.334a2.126 2.126 0 0 0-.476-.095 48.64 48.64 0 0 0-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0 0 11.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
              />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Message({ pubkey, message, signer }: { pubkey: string; message: NostrEvent; signer: ExtensionSigner }) {
  const sender = message.pubkey;
  const content = useObservableMemo(() => eventStore.model(EncryptedContentModel, message.id), [message.id]);

  const decrypt = async () => {
    await unlockLegacyMessage(message, pubkey, signer);
  };

  return (
    <div>
      <span className={`font-bold ${sender === pubkey ? "text-primary" : "text-secondary"}`}>{sender.slice(0, 8)}</span>
      :{" "}
      {content || (
        <button className="btn btn-link" onClick={decrypt}>
          decrypt
        </button>
      )}
    </div>
  );
}

function DirectMessageForm({ corraspondant, relay }: { corraspondant: string; relay: string }) {
  const [message, setMessage] = useState("");
  const [expiration, setExpiration] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    try {
      setSending(true);

      await actions
        .exec(SendLegacyMessage, corraspondant, message, {
          expiration: expiration ? unixNow() + EXPIRATIONS[expiration] : undefined,
        })
        .forEach((signed) => pool.publish([relay], signed));

      setMessage("");
    } catch (err) {
      console.error("Failed to send message:", err);
    }
    setSending(false);
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

function DirectMessageView({
  pubkey,
  corraspondant,
  relay,
  signer,
}: {
  pubkey: string;
  corraspondant: string;
  relay: string;
  signer: ExtensionSigner;
}) {
  const filters = useMemo<Filter[]>(
    () => [
      { kinds: [4], authors: [corraspondant], "#p": [pubkey] },
      { kinds: [4], authors: [pubkey], "#p": [corraspondant] },
    ],
    [corraspondant, pubkey],
  );

  const loader$ = useMemo(
    () => createTimelineLoader(pool, [relay], filters, { eventStore, cache: cacheRequest }),
    [relay, corraspondant, pubkey],
  );
  useEffect(() => {
    loader$().subscribe();
  }, [loader$]);

  // Create subscription for new events
  useObservableMemo(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [kinds.EncryptedDirectMessage], "#p": [pubkey] })
        .pipe(onlyEvents(), mapEventsToStore(eventStore)),
    [relay, pubkey],
  );

  const loadMore = useCallback(() => {
    loader$().subscribe();
  }, [loader$]);

  const messages = useObservableEagerMemo(() => eventStore.timeline(filters), [filters]);

  const decryptAll = async () => {
    try {
      for (const message of messages)
        if (isLegacyMessageLocked(message)) await unlockLegacyMessage(message, pubkey, signer);
    } catch (error) {
      // Stop of first error
    }
  };

  return (
    <div className="flex flex-col h-full p-4 overflow-hidden w-full">
      <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col-reverse gap-2">
        {messages.map((message) => (
          <Message key={message.id} pubkey={pubkey} message={message} signer={signer} />
        ))}

        <button onClick={loadMore} className="btn btn-primary mx-auto">
          Load more
        </button>
      </div>

      <div className="flex items-center gap-2 w-full mt-4">
        <DirectMessageForm corraspondant={corraspondant} relay={relay} />

        <button className="btn" onClick={decryptAll}>
          Decrypt all
        </button>
      </div>
    </div>
  );
}

function HomeView({ pubkey, signer }: { pubkey: string; signer: ExtensionSigner }) {
  const [relay, setRelay] = useState<string>("wss://relay.damus.io/");
  const [selected, setSelected] = useState<string | null>(null);

  const filters = useMemo<Filter[]>(
    () => [
      { kinds: [4], authors: [pubkey] },
      { kinds: [4], "#p": [pubkey] },
    ],
    [pubkey],
  );

  // Create a loader and start it
  const timeline = useMemo(() => createTimelineLoader(pool, [relay], filters, { eventStore }), [relay]);
  useEffect(() => {
    // Load first page of events
    timeline().subscribe();
  }, [timeline]);

  const loadMore = useCallback(() => {
    timeline().subscribe();
  }, [timeline]);

  // Get all events from the event store
  const events = useObservableEagerMemo(() => eventStore.timeline(filters), [filters]);

  const clearCache = useCallback(() => {
    localforage.clear();
    const events = eventStore.getByFilters({ kinds: [4] });
    for (const event of events) lockEncryptedContent(event);
  }, [eventStore]);

  return (
    <div className="flex bg-base-200 overflow-hidden h-screen">
      <div className="w-sm bg-base-100 p-2 overflow-y-auto flex flex-col gap-2 shrink-0">
        <div className="flex gap-2 w-full">
          <RelayPicker className="w-full" value={relay} onChange={setRelay} />
          <button className="btn" onClick={clearCache}>
            Clear
          </button>
        </div>
        <ContactList events={events} pubkey={pubkey} onSelect={setSelected} />
        <button onClick={loadMore} className="btn btn-primary mx-auto" onScroll={loadMore}>
          Load more
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <DirectMessageView pubkey={pubkey} corraspondant={selected} relay={relay} signer={signer} />
        ) : (
          <div className="flex items-center justify-center h-full text-base-content/50">
            Select a contact to start messaging
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const storage = useObservableState(storage$);
  const signer = useObservableState(signer$);
  const pubkey = useObservableState(pubkey$);

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

  // Show main app view when both storage and login are ready
  return <HomeView pubkey={pubkey} signer={signer} />;
}

export default App;
