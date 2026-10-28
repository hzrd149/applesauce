/**
 * A LegacyMessagesClient inbox with read-only browsing, incremental history and explicit decryption
 * @tags messages, legacy, nip-04, nip-65, nip-77, dm, timeline, sync
 * @related messages/gift-wrap, messages/personal-notes, loader/sync-loader
 */
import { castUser, User } from "applesauce-common/casts";
import { getLegacyMessageParent } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import {
  getDisplayName,
  getProfilePicture,
  persistEventsToCache,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import { EncryptedContentModel } from "applesauce-core/models";
import {
  LegacyMessagesClient,
  type LegacyConversation,
  type MessageStorage,
  type PreparedLegacyMessage,
} from "applesauce-extra/messages";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Lock, X } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { type ReactNode, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concat,
  defer,
  EMPTY,
  finalize,
  ignoreElements,
  map,
  merge,
  NEVER,
  of,
  shareReplay,
  switchMap,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

type HistoryRange = "recent" | "year" | "all";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
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

// The stream owns the client; a signer is optional so another user's mailbox can be browsed read-only
const client$ = combineLatest([signer$, user$, storage$]).pipe(
  switchMap(([signer, user, storage]) => {
    if (!user || (signer && !storage)) return of(undefined);

    return defer(() => {
      const client = new LegacyMessagesClient({
        pubkey: user.pubkey,
        signer,
        eventStore,
        pool,
        cacheRequest,
        decryptionCache: signer ? storage : undefined,
        draftStorage:
          storage &&
          createMessageStorage(storage.createInstance({ name: `legacy:${user.pubkey}`, storeName: "drafts" })),
        publicationStorage:
          storage &&
          createMessageStorage(storage.createInstance({ name: `legacy:${user.pubkey}`, storeName: "publications" })),
        fallbackRelays: FALLBACK_RELAYS,
        authTimeout: false,
      });

      return concat(of(client), NEVER).pipe(
        finalize(() => {
          client.dispose();
        }),
      );
    });
  }),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** Adapts encrypted storage so failed writes reject client operations */
function createMessageStorage(storage: SecureStorage): MessageStorage {
  return {
    getItem: (key) => storage.getItem(key),
    setItem: async (key, value) => {
      if (!(await storage.setItem(key, value))) throw new Error("Failed to save conversation data");
    },
    removeItem: (key) => storage.removeItem(key),
  };
}

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

  // Drop the previous mailbox so the next account starts with an empty inbox
  eventStore.removeByFilters({ kinds: [4] });
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

/** Shows the decrypted content of a message once it has been unlocked */
function Preview({ event }: { event: NostrEvent | string }) {
  const content = use$(() => eventStore.model(EncryptedContentModel, event), [event]);
  if (content !== undefined) return <>{content}</>;

  return (
    <span className="inline-flex items-center gap-1 opacity-60">
      <Lock className="h-4 w-4" /> Encrypted message
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

function InboxStatus({ client }: { client: LegacyMessagesClient }) {
  const lifecycle = use$(client.status$);
  const sync = use$(client.syncStatus$);
  const stats = use$(client.decryptionState$);
  const relays = use$(client.relays$);
  const auth = use$(client.authRequests$) ?? [];
  const failure = use$(() => client.errors$.pipe(map((failure) => String(failure.error))), [client]);

  const [decrypting, setDecrypting] = useState(false);
  const [range, setRange] = useState<HistoryRange>("recent");
  const [error, setError] = useState<string>();

  // Reconcile older history on top of the client's recent sync while a range is selected
  const history = use$(
    () => (range === "recent" ? undefined : client.sync$({ since: getHistorySince(range) })),
    [client, range],
  );
  const progress = history ?? sync;

  const relayErrors = (progress?.mailboxes ?? [])
    .flatMap((mailbox) => Object.values(mailbox.relays))
    .filter((relay) => relay.error);

  const toggleDecrypting = () => {
    client.setAutoUnlock(!decrypting);
    setDecrypting(!decrypting);
  };

  const authenticate = async (url: string) => {
    try {
      setError(undefined);
      await client.authenticate(url);
    } catch (error) {
      setError(String(error));
    }
  };

  // Only signed-in users can answer auth challenges
  const pendingAuth = client.signer ? auth : [];

  return (
    <>
      <Section title="Mailbox">
        {lifecycle === "idle" && (
          <button className="btn btn-sm" onClick={() => client.start().catch((error) => setError(String(error)))}>
            Discover conversations
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-ghost">{lifecycle ?? "loading"}</span>
          <span className="badge badge-ghost" title={relays?.join("\n")}>
            {relays ? `${relays.length} relays` : "…"}
          </span>
          <span className="badge badge-ghost">
            {progress && !progress.done && <span className="loading loading-spinner loading-sm" />}
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
        {client.signer && (
          <button className={`btn btn-sm ${decrypting ? "btn-active" : ""}`} onClick={toggleDecrypting}>
            {decrypting ? "Stop decrypting" : "Decrypt messages"}
          </button>
        )}
      </Section>

      {(pendingAuth.length > 0 || error || failure) && (
        <Section title="Attention">
          {pendingAuth.map(({ url, state, error }) => (
            <button
              key={url}
              className="btn btn-sm"
              disabled={state === "authenticating"}
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
  peer,
  lastMessage,
  active,
  onSelect,
}: {
  peer: User;
  lastMessage?: NostrEvent;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-3 border-b border-base-300 p-3 text-left ${active ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      <Avatar user={peer} size="h-10 w-10" />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <Name user={peer} />
          {lastMessage && (
            <span className="ms-auto shrink-0 text-sm opacity-60">{formatShortTime(lastMessage.created_at)}</span>
          )}
        </div>
        <span className="truncate text-sm opacity-60">
          {lastMessage ? <Preview event={lastMessage.id} /> : "Messages not loaded"}
        </span>
      </div>
    </button>
  );
}

function Account({ user, readOnly }: { user: User; readOnly: boolean }) {
  return (
    <div className="flex items-center gap-2 border-t border-base-300 p-2">
      <Avatar user={user} size="h-8 w-8" />
      <Name user={user} />
      {readOnly && <span className="badge badge-ghost">Read only</span>}
      <button className="btn btn-sm btn-ghost ms-auto" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function MessageBubble({
  client,
  event,
  publication,
  onReply,
}: {
  client: LegacyMessagesClient;
  event: NostrEvent;
  publication?: string;
  onReply: () => void;
}) {
  const content = use$(() => eventStore.model(EncryptedContentModel, event), [event]);
  const [error, setError] = useState<string>();

  const author = castUser(event.pubkey, eventStore);
  const isOwn = event.pubkey === client.pubkey;
  const parent = getLegacyMessageParent(event);

  const unlock = () => client.unlock(event).catch((error) => setError(String(error)));

  return (
    <div className={`chat ${isOwn ? "chat-end" : "chat-start"}`}>
      <div className="chat-image">
        <Avatar user={author} size="h-10 w-10" />
      </div>
      <div className="chat-header flex gap-2 text-sm">
        <Name user={author} />
        <time className="opacity-60">{formatShortTime(event.created_at)}</time>
      </div>
      {parent && (
        <div className="max-w-xs truncate border-s-2 border-base-300 ps-2 text-sm opacity-60">
          <Preview event={parent} />
        </div>
      )}
      <div className={`chat-bubble whitespace-pre-wrap ${isOwn ? "chat-bubble-primary" : ""}`}>
        {content !== undefined ? (
          content
        ) : !client.signer ? (
          <span className="inline-flex items-center gap-1 opacity-60">
            <Lock className="h-4 w-4" /> Encrypted
          </span>
        ) : (
          <button className="inline-flex items-center gap-1" onClick={unlock}>
            <Lock className="h-4 w-4" />
            {error ? "Retry decryption" : "Decrypt"}
          </button>
        )}
      </div>
      <div className="chat-footer gap-2 text-sm">
        {publication && <span className="opacity-60">{publication}</span>}
        {error && <span className="text-error">{error}</span>}
        {client.signer && (
          <button className="link opacity-60" onClick={onReply}>
            Reply
          </button>
        )}
      </div>
    </div>
  );
}

function Composer({ conversation }: { conversation: LegacyConversation }) {
  const draft = use$(conversation.draft$);
  const availability = use$(() => conversation.discover$(), [conversation]);
  const pending = use$(conversation.pendingPublications$);
  const publishing = use$(conversation.busy$);
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState<string>();
  const text = draft?.content ?? "";
  const busy = preparing || publishing;
  const hasPending = !!pending?.length;

  const publish = async (prepared?: PreparedLegacyMessage) => {
    if (busy) return;
    setPreparing(true);
    setError(undefined);

    try {
      // The conversation retains signed events so retries do not prompt the signer again.
      const delivery = prepared ?? (await conversation.prepareSend({ content: text, replyTo: draft?.replyTo }));
      await delivery.publish();
      await conversation.clearDraft();
    } catch (error) {
      setError(String(error));
    } finally {
      setPreparing(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-base-300 p-3">
      {draft?.replyTo && (
        <div className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate border-s-2 border-base-300 ps-2 opacity-60">
            <Preview event={draft.replyTo} />
          </span>
          <button
            className="btn btn-ghost btn-sm btn-square"
            title="Cancel reply"
            disabled={busy || hasPending}
            onClick={() => conversation.setDraft({ content: text }).catch((error) => setError(String(error)))}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {pending?.map((delivery) => (
        <div key={delivery.message.id} className="flex items-center gap-2">
          <span className="text-sm opacity-60">Unpublished message</span>
          <button className="btn btn-sm ms-auto" disabled={busy} onClick={() => publish(delivery)}>
            Retry
          </button>
          <button
            className="btn btn-sm btn-ghost"
            disabled={busy}
            onClick={() =>
              conversation.discardPublication(delivery.message.id).catch((error) => setError(String(error)))
            }
          >
            Discard
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <input
          className="input flex-1"
          placeholder="Message"
          value={text}
          disabled={busy || hasPending}
          onChange={(event) => {
            conversation.setDraft({ ...draft, content: event.target.value }).catch((error) => setError(String(error)));
          }}
        />
        <button
          className="btn btn-primary"
          disabled={busy || hasPending || !text.trim() || !availability?.canSend}
          onClick={() => publish()}
        >
          {busy ? <span className="loading loading-spinner loading-sm" /> : "Send"}
        </button>
      </div>
      {availability && !availability.canSend && <p className="text-sm text-warning">No delivery relays</p>}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function conversationMessages$(conversation: LegacyConversation) {
  return merge(
    conversation.messages$,
    defer(() => conversation.start()).pipe(
      ignoreElements(),
      // Startup failures are reported by the conversation's errors$ stream.
      catchError(() => EMPTY),
    ),
  ).pipe(finalize(() => conversation.stop()));
}

function Conversation({ client, other }: { client: LegacyMessagesClient; other: string }) {
  const conversation = client.conversation(other);
  const messages = use$(() => conversationMessages$(conversation), [conversation]);
  const sync = use$(conversation.syncStatus$);
  const failure = use$(() => conversation.errors$.pipe(map((failure) => String(failure.error))), [conversation]);
  const [error, setError] = useState<string>();
  const draft = use$(conversation.draft$);
  const publications = use$(conversation.publications$);

  // Page this correspondent's history back in 90 day steps
  const [since, setSince] = useState<number>();
  const older = use$(() => (since === undefined ? undefined : conversation.sync$({ since })), [conversation, since]);
  const history = older ?? sync;

  const peer = castUser(other, eventStore);
  const relayErrors = (history?.mailboxes ?? [])
    .flatMap((mailbox) => Object.values(mailbox.relays))
    .filter((relay) => relay.error);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-base-300 p-3">
        <Avatar user={peer} size="h-8 w-8" />
        <Name user={peer} />
        {client.signer && (
          <button
            className="btn btn-sm"
            onClick={() => conversation.unlock().catch((error) => setError(String(error)))}
          >
            Decrypt conversation
          </button>
        )}
        {relayErrors.length > 0 && (
          <span
            className="badge badge-error"
            title={relayErrors.map((relay) => `${relay.relay}: ${relay.error?.message}`).join("\n")}
          >
            {relayErrors.length} failed
          </span>
        )}
        <span className="badge badge-ghost ms-auto">{messages?.length ?? 0} messages</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto p-4">
        {(error || failure) && <p className="text-sm text-error">{error ?? failure}</p>}
        {messages?.map((event) => (
          <MessageBubble
            key={event.id}
            client={client}
            event={event}
            publication={publications?.[event.id]}
            onReply={() =>
              conversation
                .setDraft({ content: draft?.content ?? "", replyTo: event.id })
                .catch((error) => setError(String(error)))
            }
          />
        ))}
        {messages?.length === 0 && history?.done && <p className="text-center opacity-60">No messages</p>}
        <button
          className="btn btn-sm btn-ghost self-center"
          disabled={!history?.done || since === 0}
          onClick={() => {
            setSince(Math.max(0, (since ?? unixNow() - 30 * 86400) - 90 * 86400));
          }}
        >
          {!history?.done ? <span className="loading loading-spinner loading-sm" /> : null}
          {!history?.done ? "Loading history" : since === 0 ? "History loaded" : "Load older messages"}
        </button>
      </div>

      {client.signer && <Composer conversation={conversation} />}
    </main>
  );
}

function Inbox({ client, user }: { client: LegacyMessagesClient; user: User }) {
  const groups = use$(client.conversations$);
  const [other, setOther] = useState<string>();

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-72 shrink-0 flex-col border-e border-base-300">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="border-b border-base-300 p-3">
            <PubkeyPicker
              value={other ?? ""}
              placeholder="Open a conversation"
              onChange={(pubkey) => setOther(pubkey || undefined)}
            />
          </div>

          <InboxStatus client={client} />

          {groups === undefined ? (
            <div className="flex justify-center p-6">
              <span className="loading loading-dots" />
            </div>
          ) : groups.length === 0 ? (
            <p className="p-6 text-center opacity-60">No conversations</p>
          ) : (
            groups.map((group) => {
              const peer = group.participants.find((pubkey) => pubkey !== client.pubkey) ?? client.pubkey;
              return (
                <ConversationRow
                  key={group.id}
                  peer={castUser(peer, eventStore)}
                  lastMessage={group.lastMessage}
                  active={other === peer}
                  onSelect={() => setOther(peer)}
                />
              );
            })
          )}
        </div>
        <Account user={user} readOnly={!client.signer} />
      </aside>

      {other ? (
        <Conversation key={other} client={client} other={other} />
      ) : (
        <main className="flex min-w-0 flex-1 items-center justify-center opacity-60">Select a conversation</main>
      )}
    </div>
  );
}

export default function LegacyMessagesExample() {
  const signer = use$(signer$);
  const user = use$(user$);
  const storage = use$(storage$);
  const client = use$(client$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  const browse = (pubkey: string) => {
    if (pubkey) user$.next(castUser(pubkey, eventStore));
  };

  if (!user)
    return (
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <div className="border-b border-base-300 p-3">
          <PubkeyPicker value="" placeholder="Browse a mailbox read-only" onChange={browse} />
        </div>
        <LoginView onLogin={handleLogin} />
      </div>
    );
  if (signer && !storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  if (!client) return <span className="loading loading-spinner m-auto" />;

  return <Inbox key={user.pubkey} client={client} user={user} />;
}
