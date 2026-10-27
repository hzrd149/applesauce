/**
 * A WrappedMessagesClient inbox with cached history, explicit decryption and retryable publication
 * @tags nip-17, nip-44, nip-59, nip-77, messages, gift-wrap, encryption, dm, sync
 * @related messages/personal-notes, messages/legacy, loader/sync-loader
 */
import { castUser, User } from "applesauce-common/casts";
import { getConversationParticipants, getRumorGiftWraps, getRumorSeals, type Rumor } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  persistEventsToCache,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import { WrappedMessagesClient, type PreparedWrappedMessage } from "applesauce-extra/messages";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { type ReactNode, useState } from "react";
import { BehaviorSubject, combineLatest, concat, defer, finalize, map, NEVER, of, shareReplay, switchMap } from "rxjs";

import JsonBlock from "../../components/json-block";
import LoginView, { forgetActiveAccount } from "../../components/login-view";
import NoteContent from "../../components/note-content";
import PubkeyPicker from "../../components/pubkey-picker";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

type HistoryRange = "recent" | "year" | "all";

const HISTORY_RANGES: { value: HistoryRange; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "year", label: "Year" },
  { value: "all", label: "All" },
];

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);
const storage$ = new BehaviorSubject<SecureStorage | undefined>(undefined);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

const db = await openDB();
const cacheRequest = async (filters: Parameters<typeof getEventsForFilters>[1]) =>
  (await getEventsForFilters(db, filters)) as NostrEvent[];

persistEventsToCache(eventStore, (events) => addEvents(db, events));
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, cacheRequest });

// The stream owns the client; switching accounts or leaving the page disposes it
const client$ = combineLatest([signer$, user$, storage$]).pipe(
  switchMap(([signer, user, storage]) => {
    if (!signer || !user || !storage) return of(undefined);

    return defer(() => {
      const client = new WrappedMessagesClient({
        pubkey: user.pubkey,
        signer,
        pool,
        eventStore,
        cacheRequest,
        decryptionCache: storage,
        authTimeout: false,
      });

      return defer(() => client.start()).pipe(
        switchMap(() => concat(of(client), NEVER)),
        finalize(() => {
          client.dispose();
        }),
      );
    });
  }),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** Returns the start of a history range, or undefined for the client's recent sync */
function getHistorySince(range: HistoryRange) {
  if (range === "year") return unixNow() - 365 * 86400;
  if (range === "all") return 0;
  return undefined;
}

/** Formats a timestamp as a time for today and a date otherwise */
function formatShortTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString();
}

function logout() {
  // Stop the login view from restoring this account when it mounts again
  forgetActiveAccount();
  signer$.next(undefined);
  user$.next(undefined);
  storage$.next(undefined);
}

function Avatar({ user, size = "h-6 w-6" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}.png`)}
      className={`${size} shrink-0 rounded-full`}
    />
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <span className="min-w-0 truncate font-medium">{getDisplayName(profile, user.npub.slice(0, 12))}</span>;
}

/** Lists the other participants of a group conversation as comma separated names */
function Names({ users }: { users: User[] }) {
  return (
    <span className="flex min-w-0 gap-1 truncate">
      {users.map((user, index) => (
        <span key={user.pubkey} className="flex min-w-0">
          <Name user={user} />
          {index < users.length - 1 && ","}
        </span>
      ))}
    </span>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-base-300 p-3">
      <span className="text-sm opacity-60">{title}</span>
      {children}
    </div>
  );
}

function InboxStatus({ client }: { client: WrappedMessagesClient }) {
  const sync = use$(client.syncStatus$);
  const stats = use$(client.decryptionState$);
  const relays = use$(client.relays$);
  const auth = use$(client.authRequests$) ?? [];
  const failure = use$(() => client.errors$.pipe(map((failure) => String(failure.error))), [client]);

  const [decrypting, setDecrypting] = useState(false);
  const [range, setRange] = useState<HistoryRange>("recent");
  const [error, setError] = useState<string>();

  // Reconcile older history on top of the client's recent sync while a range is selected
  const since = getHistorySince(range);
  const history = use$(() => (since === undefined ? undefined : client.sync$({ since })), [client, since]);
  const progress = history ?? sync;

  const relayErrors = (progress?.mailboxes ?? [])
    .flatMap((mailbox) => Object.values(mailbox.relays))
    .filter((relay) => relay.error);

  const toggleDecrypting = () => {
    client.setAutoUnlock(!decrypting);
    setDecrypting(!decrypting);
  };

  const retryFailed = async () => {
    for (const id of stats?.failed ?? []) {
      const event = eventStore.getEvent(id);
      if (event) await client.retryDecryption(event).catch((error) => setError(String(error)));
    }
  };

  const authenticate = async (url: string) => {
    try {
      setError(undefined);
      await client.authenticate(url);
    } catch (error) {
      setError(String(error));
    }
  };

  return (
    <>
      <Section title="Inbox">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-ghost" title={relays?.join("\n")}>
            {relays ? `${relays.length} relays` : "…"}
          </span>
          <span className="badge badge-ghost">
            {!progress?.done && <span className="loading loading-spinner loading-sm" />}
            {progress?.loaded ?? 0} events
          </span>
          {relayErrors.length > 0 && (
            <span
              className="badge badge-error"
              title={relayErrors.map((relay) => `${relay.relay}: ${relay.error?.message}`).join("\n")}
            >
              {relayErrors.length} failed
            </span>
          )}
        </div>
        <div className="join">
          {HISTORY_RANGES.map((option) => (
            <button
              key={option.value}
              className={`btn btn-sm join-item flex-1 ${range === option.value ? "btn-active" : ""}`}
              onClick={() => setRange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Decryption">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-ghost">{stats?.unlocked ?? 0} unlocked</span>
          <span className="badge badge-ghost">{stats?.locked ?? 0} locked</span>
          {!!stats?.failed.length && <span className="badge badge-error">{stats.failed.length} failed</span>}
        </div>
        <div className="flex gap-2">
          <button className={`btn btn-sm flex-1 ${decrypting ? "btn-active" : ""}`} onClick={toggleDecrypting}>
            {decrypting ? "Stop decrypting" : "Decrypt messages"}
          </button>
          {!!stats?.failed.length && (
            <button className="btn btn-sm" onClick={retryFailed}>
              Retry
            </button>
          )}
        </div>
      </Section>

      {(auth.length > 0 || error || failure) && (
        <Section title="Attention">
          {auth.map(({ url, state, error }) => (
            <button
              key={url}
              className="btn btn-sm"
              disabled={state === "authenticating" || !client.signer}
              title={error ? String(error) : url}
              onClick={() => authenticate(url)}
            >
              {state === "authenticating"
                ? "Authenticating"
                : state === "failed"
                  ? "Retry authentication"
                  : "Authenticate"}{" "}
              {new URL(url).hostname}
            </button>
          ))}
          {(error ?? failure) && <p className="text-sm text-error">{error ?? failure}</p>}
        </Section>
      )}
    </>
  );
}

function ConversationRow({
  group,
  self,
  active,
  onSelect,
}: {
  group: { id: string; participants: string[]; lastMessage: Rumor };
  self: User;
  active: boolean;
  onSelect: () => void;
}) {
  const others = group.participants
    .filter((pubkey) => pubkey !== self.pubkey)
    .map((pubkey) => castUser(pubkey, eventStore));
  const isSelf = others.length === 0;

  return (
    <button
      className={`flex w-full items-center gap-3 border-b border-base-300 p-3 text-left ${active ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      <Avatar user={others[0] ?? self} size="h-10 w-10" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          {isSelf ? <span className="font-medium">Notes to self</span> : <Names users={others} />}
          {others.length > 1 && <span className="badge badge-ghost">{others.length}</span>}
          <span className="ms-auto shrink-0 text-sm opacity-60">{formatShortTime(group.lastMessage.created_at)}</span>
        </div>
        <span className="truncate text-sm opacity-60">{group.lastMessage.content}</span>
      </div>
    </button>
  );
}

function Account({ user }: { user: User }) {
  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <Avatar user={user} size="h-8 w-8" />
      <Name user={user} />
      <button className="btn btn-sm btn-ghost ms-auto" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function Composer({ client, participants }: { client: WrappedMessagesClient; participants: string[] }) {
  const [text, setText] = useState("");
  const [expiration, setExpiration] = useState(0);
  const [prepared, setPrepared] = useState<PreparedWrappedMessage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const send = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);

    try {
      const expires = expiration ? unixNow() + expiration : undefined;

      // Keep the prepared gift wraps so a retry only republishes to recipients that were not accepted
      const delivery =
        prepared ??
        (await client.prepareSend({
          recipients: participants,
          content: text,
          expiration: expires,
          envelopeExpiration: expires,
        }));
      setPrepared(delivery);

      await delivery.publish();
      setPrepared(undefined);
      setText("");
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-base-300 p-3">
      <div className="flex gap-2">
        <textarea
          className="textarea flex-1"
          rows={1}
          placeholder="Message"
          value={text}
          disabled={!!prepared || busy}
          onChange={(event) => setText(event.target.value)}
        />
        <select
          aria-label="Message expiration"
          className="select w-36"
          value={expiration}
          disabled={!!prepared}
          onChange={(event) => setExpiration(Number(event.target.value))}
        >
          <option value={0}>Never expire</option>
          <option value={3600}>1 hour</option>
          <option value={86400}>1 day</option>
          <option value={7 * 86400}>1 week</option>
        </select>
        <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={send}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : prepared ? "Retry" : "Send"}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function MessageDetails({ message, onClose }: { message: Rumor; onClose: () => void }) {
  return (
    <dialog
      className="modal"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onClose={onClose}
    >
      <div className="modal-box max-w-4xl">
        <JsonBlock value={{ rumor: message, seals: getRumorSeals(message), wraps: getRumorGiftWraps(message) }} />
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>Close</button>
      </form>
    </dialog>
  );
}

function MessageBubble({
  message,
  self,
  status,
  onInspect,
}: {
  message: Rumor;
  self: string;
  status?: string;
  onInspect: () => void;
}) {
  const author = castUser(message.pubkey, eventStore);
  const isOwn = message.pubkey === self;

  return (
    <div className={`chat ${isOwn ? "chat-end" : "chat-start"}`}>
      <div className="chat-image">
        <Avatar user={author} size="h-10 w-10" />
      </div>
      <div className="chat-header flex gap-2 text-sm">
        <Name user={author} />
        <time className="opacity-60">{formatShortTime(message.created_at)}</time>
      </div>
      <div className={`chat-bubble ${isOwn ? "chat-bubble-primary" : ""}`}>
        <NoteContent event={message} />
      </div>
      <div className="chat-footer gap-2 text-sm">
        {status && <span className="opacity-60">{status}</span>}
        <button className="link opacity-60" onClick={onInspect}>
          Details
        </button>
      </div>
    </div>
  );
}

function Conversation({ client, id }: { client: WrappedMessagesClient; id: string }) {
  const messages = use$(() => client.conversation$(id), [client, id]);
  const publications = use$(client.publications$);
  const [inspecting, setInspecting] = useState<Rumor>();

  const participants = getConversationParticipants(id);
  const others = participants
    .filter((pubkey) => pubkey !== client.pubkey)
    .map((pubkey) => castUser(pubkey, eventStore));

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-base-300 p-3">
        {others.length === 0 ? (
          <span className="font-medium">Notes to self</span>
        ) : (
          <>
            <div className="flex -space-x-3">
              {others.map((user) => (
                <Avatar key={user.pubkey} user={user} size="h-8 w-8" />
              ))}
            </div>
            <Names users={others} />
          </>
        )}
        <span className="badge badge-ghost ms-auto">{messages?.length ?? 0} messages</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto p-4">
        {messages === undefined ? (
          <span className="loading loading-dots mx-auto" />
        ) : messages.length === 0 ? (
          <p className="text-center opacity-60">No messages</p>
        ) : (
          messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              self={client.pubkey}
              status={publications?.[message.id]}
              onInspect={() => setInspecting(message)}
            />
          ))
        )}
      </div>

      <Composer key={id} client={client} participants={participants} />
      {inspecting && <MessageDetails message={inspecting} onClose={() => setInspecting(undefined)} />}
    </main>
  );
}

function Inbox({ client, user }: { client: WrappedMessagesClient; user: User }) {
  const groups = use$(client.conversations$);
  const [selected, setSelected] = useState(client.pubkey);

  const startConversation = (pubkey: string) => {
    if (pubkey) setSelected([pubkey, client.pubkey].sort().join(":"));
  };

  // Keep notes to self pinned at the top even before it has any messages
  const selfGroup = groups?.find((group) => group.id === client.pubkey);
  const otherGroups = groups?.filter((group) => group.id !== client.pubkey) ?? [];

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-72 shrink-0 flex-col border-e border-base-300">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-base-300 p-3">
            <PubkeyPicker value="" placeholder="Start a conversation" onChange={startConversation} />
          </div>

          <InboxStatus client={client} />

          {selfGroup ? (
            <ConversationRow
              group={selfGroup}
              self={user}
              active={selected === selfGroup.id}
              onSelect={() => setSelected(selfGroup.id)}
            />
          ) : (
            <button
              className={`flex w-full items-center gap-3 border-b border-base-300 p-3 text-left ${selected === client.pubkey ? "bg-base-200" : ""}`}
              onClick={() => setSelected(client.pubkey)}
            >
              <Avatar user={user} size="h-10 w-10" />
              <span className="font-medium">Notes to self</span>
            </button>
          )}

          {groups === undefined ? (
            <div className="flex justify-center p-6">
              <span className="loading loading-dots" />
            </div>
          ) : otherGroups.length === 0 ? (
            <p className="p-6 text-center opacity-60">No conversations</p>
          ) : (
            otherGroups.map((group) => (
              <ConversationRow
                key={group.id}
                group={group}
                self={user}
                active={selected === group.id}
                onSelect={() => setSelected(group.id)}
              />
            ))
          )}
        </div>
        <Account user={user} />
      </aside>

      <Conversation client={client} id={selected} />
    </div>
  );
}

export default function WrappedMessagesExample() {
  const signer = use$(signer$);
  const user = use$(user$);
  const storage = use$(storage$);
  const client = use$(client$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!signer || !user) return <LoginView onLogin={handleLogin} />;
  if (!storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  if (!client) return <span className="loading loading-spinner m-auto" />;

  return <Inbox key={user.pubkey} client={client} user={user} />;
}
