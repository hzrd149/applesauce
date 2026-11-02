/**
 * A LegacyMessagesClient inbox with cached history, encrypted storage, recoverable sends and explicit decryption
 * @tags messages, legacy, nip-04, nip-65, nip-77, dm, timeline, sync, cache, storage
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
  type MessageAuthRequest,
  type PreparedLegacyMessage,
} from "applesauce-extra/messages";
import { createEventLoaderForStore, isTimelineWindowCovered, type TimelineWindow } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { Lock, PanelLeft, PanelRight, X } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import {
  BehaviorSubject,
  combineLatest,
  catchError,
  concat,
  defer,
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
import { createPrefixedStorage } from "../../extra/prefixed-storage";
import { verifyEvent } from "../../extra/verifier";
import { lookupRelays$ } from "../../settings";

type HistoryRange = "recent" | "year" | "all";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
const MONTH = 30 * 86400;
const YEAR = 365 * 86400;
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

// Persist native events (whose kind-4 content is still encrypted) for offline history reads.
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
        // Keep decrypted text encrypted at rest, isolated from other accounts and protocols.
        decryptionCache: storage && createPrefixedStorage(storage, `legacy:${user.pubkey}:decryption:`),
        // Restore unsent text and reply targets when a conversation is reopened.
        draftStorage: storage && createPrefixedStorage(storage, `legacy:${user.pubkey}:drafts:`),
        // Retain signed events across reloads so failed sends can retry without signing again.
        publicationStorage: storage && createPrefixedStorage(storage, `legacy:${user.pubkey}:publications:`),
        // Restore the correspondent list even before cached or relay messages arrive.
        conversationStorage: storage && createPrefixedStorage(storage, `legacy:${user.pubkey}:conversations:`),
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

/** Returns the start of a preset history range */
function getHistorySince(range: HistoryRange) {
  if (range === "year") return unixNow() - YEAR;
  if (range === "all") return 0;
  return unixNow() - MONTH;
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

function AuthenticationRelay({ request, onAuthenticate }: { request: MessageAuthRequest; onAuthenticate: () => void }) {
  const relay = pool.relay(request.url);
  const name = use$(relay.name$);
  const icon = use$(relay.icon$);

  return (
    <button
      className="flex min-w-0 items-center gap-2 rounded p-2 text-left hover:bg-base-200 disabled:opacity-60"
      disabled={request.state === "authenticating"}
      title={request.error ? String(request.error) : request.url}
      onClick={onAuthenticate}
    >
      <img src={icon} alt="" className="h-6 w-6 shrink-0 rounded" />
      <span className="min-w-0 flex-1 truncate">{name ?? new URL(request.url).hostname}</span>
      {request.state === "authenticating" && <span className="loading loading-spinner loading-sm" />}
      {request.state === "failed" && <span className="text-sm text-error">Retry</span>}
    </button>
  );
}

function InboxStatus({ client }: { client: LegacyMessagesClient }) {
  const stats = use$(client.decryptionState$);
  const relays = use$(client.relays$);
  const auth = use$(client.authRequests$) ?? [];
  const lifecycle = use$(client.lifecycle$);
  const cacheError = use$(client.cacheError$);
  const conversationStorageError = use$(client.conversationStorageError$);
  const mailboxFailure = use$(client.mailboxErrors$);

  const autoUnlock = use$(client.autoUnlock$) ?? false;
  const [range, setRange] = useState<HistoryRange>("recent");
  const [error, setError] = useState<string>();

  const [decrypting, setDecrypting] = useState(false);

  const decryptLoadedMessages = async () => {
    setDecrypting(true);
    setError(undefined);
    try {
      await client.unlock();
    } catch (error) {
      setError(String(error));
    } finally {
      setDecrypting(false);
    }
  };

  const [syncRequest, setSyncRequest] = useState<{ since: number }>();
  const progress = use$(
    () =>
      syncRequest &&
      concat(
        defer(() => client.start()).pipe(ignoreElements()),
        client.sync$({ ...syncRequest, followRelays: false }),
      ).pipe(
        map((progress) => ({ ...progress, error: undefined as string | undefined })),
        catchError((error) => of({ done: true, loaded: 0, mailboxes: [], error: String(error) })),
      ),
    [client, syncRequest],
  );
  const syncing = !!syncRequest && !progress?.done;

  const relayErrors = (progress?.mailboxes ?? [])
    .flatMap((mailbox) => Object.values(mailbox.relays))
    .filter((relay) => relay.error);

  const [authenticatingAll, setAuthenticatingAll] = useState(false);

  const authenticate = async (urls: string[]) => {
    setError(undefined);
    const failures: string[] = [];

    // Queue signer prompts and keep trying the remaining relays after a rejection.
    for (const url of urls) {
      try {
        await client.authenticate(url);
      } catch (error) {
        failures.push(`${new URL(url).hostname}: ${String(error)}`);
      }
    }
    if (failures.length) setError(failures.join("; "));
  };

  // Only signed-in users can answer auth challenges
  const pendingAuth = client.signer ? auth : [];

  return (
    <>
      <Section title="Decryption">
        <label className="flex items-center justify-between gap-3 text-sm">
          Auto-decrypt messages
          <input
            type="checkbox"
            className="toggle toggle-sm"
            checked={autoUnlock}
            disabled={!client.signer}
            onChange={(event) => client.setAutoUnlock(event.target.checked)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-ghost">{stats?.unlocked ?? 0} unlocked</span>
          <span className="badge badge-ghost">{stats?.locked ?? 0} locked</span>
          {!!stats?.failed.length && <span className="badge badge-error">{stats.failed.length} failed</span>}
          {client.signer && (stats?.locked ?? 0) > 0 && (
            <button
              className="btn btn-sm ms-auto"
              title="Decrypt all locked messages currently in memory"
              disabled={decrypting}
              onClick={decryptLoadedMessages}
            >
              {decrypting && <span className="loading loading-spinner loading-sm" />}
              Decrypt
            </button>
          )}
        </div>
      </Section>

      <Section title="Inbox">
        <div className="flex items-center gap-2">
          <select
            aria-label="Sync range"
            className="select select-sm min-w-0 flex-1"
            value={range}
            onChange={(event) => setRange(event.target.value as HistoryRange)}
          >
            {HISTORY_RANGES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-sm"
            disabled={syncing}
            onClick={() => {
              setError(undefined);
              setSyncRequest({ since: getHistorySince(range) });
            }}
          >
            {syncing && <span className="loading loading-spinner loading-sm" />}
            Sync
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm opacity-60">
          <span>{lifecycle}</span>
          <span title={relays?.join("\n")}>{relays?.length ?? 0} relays</span>
          {progress && <span>{progress.loaded} events</span>}
          {relayErrors.length > 0 && (
            <span
              className="text-error"
              title={relayErrors.map((relay) => `${relay.relay}: ${relay.error?.message}`).join("\n")}
            >
              {relayErrors.length} failed
            </span>
          )}
        </div>
      </Section>

      {pendingAuth.length > 0 && (
        <Section title="Authentication">
          {pendingAuth.map((request) => (
            <AuthenticationRelay
              key={request.url}
              request={request}
              onAuthenticate={() => {
                void authenticate([request.url]);
              }}
            />
          ))}
          <button
            className="btn btn-sm"
            disabled={authenticatingAll || pendingAuth.every((request) => request.state === "authenticating")}
            onClick={async () => {
              setAuthenticatingAll(true);
              try {
                await authenticate(
                  pendingAuth.filter((request) => request.state !== "authenticating").map((request) => request.url),
                );
              } finally {
                setAuthenticatingAll(false);
              }
            }}
          >
            {authenticatingAll && <span className="loading loading-spinner loading-sm" />}
            Auth all
          </button>
        </Section>
      )}
      {(error ?? progress?.error) && (
        <p className="p-3 text-sm text-error [overflow-wrap:anywhere]">{error ?? progress?.error}</p>
      )}
      {cacheError !== undefined && <p className="p-3 text-sm text-error">Cache: {String(cacheError)}</p>}
      {conversationStorageError !== undefined && (
        <p className="p-3 text-sm text-error">Conversations: {String(conversationStorageError)}</p>
      )}
      {mailboxFailure && (
        <p className="p-3 text-sm text-error" title={mailboxFailure.relays.join("\n")}>
          {mailboxFailure.mailbox}: {String(mailboxFailure.error)}
        </p>
      )}
    </>
  );
}

function ConversationRow({
  peer,
  conversation,
  active,
  onSelect,
}: {
  peer: User;
  conversation: LegacyConversation;
  active: boolean;
  onSelect: () => void;
}) {
  const lastMessage = use$(conversation.lastMessage$);

  return (
    <button
      className={`flex w-full items-center gap-3 border-b border-base-300 p-3 text-left ${active ? "bg-base-200" : ""}`}
      onClick={onSelect}
    >
      <Avatar user={peer} size="h-10 w-10" />
      <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
        <div className="flex items-center gap-2">
          <Name user={peer} />
          {lastMessage && (
            <span className="ms-auto shrink-0 text-sm opacity-60">{formatShortTime(lastMessage.created_at)}</span>
          )}
        </div>
        <span className="truncate text-sm opacity-60">
          {lastMessage ? <Preview event={lastMessage} /> : "Messages not loaded"}
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
    <div className={`chat min-w-0 ${isOwn ? "chat-end" : "chat-start"}`}>
      <div className="chat-image">
        <Avatar user={author} size="h-10 w-10" />
      </div>
      <div className="chat-header flex min-w-0 flex-wrap gap-2 text-sm">
        <Name user={author} />
        <time className="opacity-60">{formatShortTime(event.created_at)}</time>
      </div>
      {parent && (
        <div className="max-w-xs truncate border-s-2 border-base-300 ps-2 text-sm opacity-60">
          <Preview event={parent} />
        </div>
      )}
      <div
        className={`chat-bubble min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] ${isOwn ? "chat-bubble-primary" : ""}`}
      >
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
      <div className="chat-footer flex min-w-0 flex-wrap gap-2 text-sm [overflow-wrap:anywhere]">
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
  const sending = use$(conversation.sending$);
  const [error, setError] = useState<string>();
  const text = draft?.content ?? "";
  const hasPending = !!pending?.length;

  const publish = async (prepared?: PreparedLegacyMessage) => {
    if (sending) return;
    setError(undefined);

    try {
      // The conversation retains signed events so retries do not prompt the signer again.
      if (prepared) await conversation.publish(prepared);
      else await conversation.send({ content: text, replyTo: draft?.replyTo });
      await conversation.clearDraft();
    } catch (error) {
      setError(String(error));
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
            disabled={sending || hasPending}
            onClick={() => conversation.setDraft({ content: text }).catch((error) => setError(String(error)))}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      {pending?.map((delivery) => (
        <div key={delivery.message.id} className="flex items-center gap-2">
          <span className="text-sm opacity-60">Unpublished message</span>
          <button className="btn btn-sm ms-auto" disabled={sending} onClick={() => publish(delivery)}>
            Retry
          </button>
          <button
            className="btn btn-sm btn-ghost"
            disabled={sending}
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
          className="input min-w-0 flex-1"
          placeholder="Message"
          value={text}
          disabled={sending || hasPending}
          onChange={(event) => {
            conversation.setDraft({ ...draft, content: event.target.value }).catch((error) => setError(String(error)));
          }}
        />
        <button
          className="btn btn-primary"
          disabled={sending || hasPending || !text.trim() || !availability?.canSend}
          onClick={() => publish()}
        >
          {sending ? <span className="loading loading-spinner loading-sm" /> : "Send"}
        </button>
      </div>
      {availability && !availability.canSend && <p className="text-sm text-warning">No delivery relays</p>}
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

/** Returns the next older history slice, skipping further back across quiet periods */
function getOlderSlice(slice: TimelineWindow, messages: NostrEvent[]): TimelineWindow {
  const hasMessages = messages.some(
    (message) => message.created_at >= slice.since && message.created_at <= slice.until,
  );

  // Reset to a month near messages; double across quiet periods, capped at a year.
  const step = hasMessages ? MONTH : Math.min((slice.until - slice.since) * 2, YEAR);

  return { since: Math.max(0, slice.since - step), until: slice.since };
}

function Conversation({
  client,
  conversation,
  other,
}: {
  client: LegacyMessagesClient;
  conversation: LegacyConversation;
  other: string;
}) {
  const [slice, setSlice] = useState<TimelineWindow>(() => ({ since: unixNow() - MONTH, until: unixNow() }));
  // The conversation supplies its mailbox routes, EventStore and nostr-idb cacheRequest.
  const loader = useMemo(() => conversation.createTimelineLoader({ limit: 50, prefetch: 0 }), [conversation]);

  use$(() => conversation.watch$(), [conversation]);
  const messages = use$(conversation.messages$);
  const relays = use$(conversation.relays$);

  // Subscribing to the current slice drives the load while status$ reports its coverage.
  const coverage = use$(() => merge(loader.status$, loader(slice).pipe(ignoreElements())), [loader, slice]);

  // Cache coverage alone cannot establish that relay history has been loaded.
  const covered =
    !!relays?.length &&
    relays.every((relay) => coverage?.some((source) => source.source === relay)) &&
    isTimelineWindowCovered(slice, coverage ?? []);
  const complete = covered && slice.since === 0;
  const relayErrors = coverage?.filter((source) => source.state === "incomplete") ?? [];
  const loading = !relays || (relays.length > 0 && !covered && relayErrors.length === 0);

  // Re-created once the slice is covered, so the observer's first callback pages if the edge is still visible.
  const watchHistoryEdge = useCallback(
    (edge: HTMLDivElement | null) => {
      if (!edge || !covered || slice.since === 0) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setSlice(getOlderSlice(slice, messages ?? []));
        },
        { root: edge.parentElement, rootMargin: "300px" },
      );
      observer.observe(edge);
      return () => observer.disconnect();
    },
    [covered, slice, messages],
  );

  const failure = use$(() => conversation.errors$.pipe(map((failure) => String(failure.error))), [conversation]);
  const [error, setError] = useState<string>();
  const [decrypting, setDecrypting] = useState(false);

  const decryptAll = async () => {
    setDecrypting(true);
    setError(undefined);
    try {
      await conversation.unlock();
    } catch (error) {
      setError(String(error));
    } finally {
      setDecrypting(false);
    }
  };

  const draft = use$(conversation.draft$);
  const publications = use$(conversation.publications$);
  const decryption = use$(conversation.decryptionState$);

  const peer = castUser(other, eventStore);

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 p-3">
        <Avatar user={peer} size="h-8 w-8" />
        <Name user={peer} />
        <span className="badge badge-ghost ms-auto">{messages?.length ?? 0} messages</span>
        {client.signer && (decryption?.locked ?? 0) > 0 && (
          <button
            className="btn btn-sm"
            title="Decrypt all loaded messages in this conversation"
            disabled={decrypting}
            onClick={decryptAll}
          >
            {decrypting && <span className="loading loading-spinner loading-sm" />}
            Decrypt all
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-x-hidden overflow-y-auto p-4">
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
        {messages?.length === 0 && complete && <p className="text-center opacity-60">No messages</p>}
        <div ref={watchHistoryEdge} className="flex min-h-8 shrink-0 justify-center text-sm opacity-60">
          {loading ? (
            <span className="loading loading-spinner loading-sm" />
          ) : relayErrors.length > 0 ? (
            <span
              className="text-warning"
              title={relayErrors.map((source) => `${source.source}: ${String(source.error)}`).join("\n")}
            >
              History incomplete
            </span>
          ) : !relays?.length ? (
            "No history relays"
          ) : complete ? (
            "History loaded"
          ) : (
            "Scroll up for older messages"
          )}
        </div>
      </div>

      {client.signer && <Composer conversation={conversation} />}
    </main>
  );
}

function Inbox({ client, user }: { client: LegacyMessagesClient; user: User }) {
  const groups = use$(client.conversations$);
  const [other, setOther] = useState<string>();
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [conversationsOpen, setConversationsOpen] = useState(true);
  const conversation = other ? client.conversation(other) : undefined;

  return (
    <div className="flex min-h-0 min-w-0 grow flex-col overflow-x-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-base-300 px-3 py-2">
        <button
          className="btn btn-sm btn-square btn-ghost"
          aria-label="Toggle conversations drawer"
          title={conversationsOpen ? "Hide conversations" : "Show conversations"}
          aria-expanded={conversationsOpen}
          aria-controls="conversations-drawer"
          onClick={() => setConversationsOpen(!conversationsOpen)}
        >
          <PanelLeft className="h-5 w-5" />
        </button>
        <button
          className="btn btn-sm btn-square btn-ghost"
          aria-label="Toggle mailbox controls drawer"
          title={drawerOpen ? "Hide mailbox controls" : "Show mailbox controls"}
          aria-expanded={drawerOpen}
          aria-controls="mailbox-drawer"
          onClick={() => setDrawerOpen(!drawerOpen)}
        >
          <PanelRight className="h-5 w-5" />
        </button>
      </header>
      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <aside
          id="conversations-drawer"
          aria-label="Conversations"
          hidden={!conversationsOpen}
          className="flex w-72 shrink-0 flex-col border-e border-base-300"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="border-b border-base-300 p-3">
              <PubkeyPicker
                value={other ?? ""}
                placeholder="Open a conversation"
                onChange={(pubkey) => setOther(pubkey || undefined)}
              />
            </div>

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
                    conversation={client.conversation(peer)}
                    active={other === peer}
                    onSelect={() => setOther(peer)}
                  />
                );
              })
            )}
          </div>
          <Account user={user} readOnly={!client.signer} />
        </aside>

        {other && conversation ? (
          <Conversation key={other} client={client} conversation={conversation} other={other} />
        ) : (
          <main className="flex min-w-0 flex-1 items-center justify-center opacity-60">Select a conversation</main>
        )}
        <aside
          id="mailbox-drawer"
          aria-label="Mailbox controls"
          hidden={!drawerOpen}
          className="w-80 shrink-0 overflow-x-hidden overflow-y-auto border-s border-base-300 bg-base-100"
        >
          <InboxStatus client={client} />
        </aside>
      </div>
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
