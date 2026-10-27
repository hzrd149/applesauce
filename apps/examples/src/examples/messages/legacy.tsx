/**
 * A NIP-04 direct message client that loads received messages from inbox relays and sent ones from outbox relays as you scroll, with bulk sync for a date range
 * @tags messages, legacy, nip-04, nip-65, nip-77, dm, timeline, sync
 * @related messages/gift-wrap, loader/sync-loader, loader/infinite-scroll
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { ReplyToLegacyMessage, SendLegacyMessage } from "applesauce-actions/actions";
import { castUser, User } from "applesauce-common/casts";
import {
  getLegacyMessageCorrespondent,
  getLegacyMessageParent,
  groupMessageEvents,
  unlockLegacyMessage,
} from "applesauce-common/helpers";
import { LegacyMessagesGroup } from "applesauce-common/models";
import { defined, EventStore } from "applesauce-core";
import {
  getOrDecryptEncryptedContent,
  isEncryptedContentFromCache,
  isEncryptedContentUnlocked,
  kinds,
  mergeRelaySets,
  NostrEvent,
  persistEventsToCache,
  saveEncryptedContent,
  unixNow,
} from "applesauce-core/helpers";
import { npubEncode, ProfilePointer } from "applesauce-core/helpers/pointers";
import { EncryptedContentModel } from "applesauce-core/models";
import { restoreEncryptedContentFromCache, watchEventsUpdates } from "applesauce-core/observable";
import {
  createEventLoaderForStore,
  createOutboxTimelineLoader,
  createSyncLoader,
  SyncAuthContext,
  SyncAuthHandler,
  TimelineLoader,
  TimelineStatus,
} from "applesauce-loaders/loaders";
import { CacheRequest } from "applesauce-loaders";
import { use$ } from "applesauce-react/hooks";
import { ignoreUnhealthyRelays, RelayLiveness, RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useMemo, useState } from "react";
import {
  asapScheduler,
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinctUntilChanged,
  filter,
  ignoreElements,
  map,
  merge,
  Observable,
  observeOn,
  of,
  scan,
  startWith,
  switchMap,
  take,
  tap,
} from "rxjs";

import LoginView, { forgetActiveAccount } from "../../components/login-view";
import PubkeyPicker from "../../components/pubkey-picker";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const DAY = 24 * 60 * 60;
// How far back the sync panel can load, zero syncs the whole history
const SYNC_SPANS = [
  ["Last month", 30 * DAY],
  ["Last 6 months", 182 * DAY],
  ["Last year", 365 * DAY],
  ["Last 5 years", 5 * 365 * DAY],
  ["All time", 0],
] as const;

const storage$ = new BehaviorSubject<SecureStorage | null>(null);
// Without a signer the inbox is read only, NIP-04 exposes who is messaging whom but not what they say
const signer$ = new BehaviorSubject<ISigner | null>(null);
const user$ = new BehaviorSubject<User | null>(null);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
// Drops failing inbox relays from the relay set until they recover
const liveness = new RelayLiveness();
liveness.connectToPool(pool);

// Cache every event locally so the inbox opens instantly on the next visit
const db = await openDB();
const cache: CacheRequest = (filters) => getEventsForFilters(db, filters) as Promise<NostrEvent[]>;
persistEventsToCache(eventStore, (events) => addEvents(db, events));

// Messages the signer could not decrypt, remembered so they don't prompt again
const failed$ = new BehaviorSubject<string[]>(JSON.parse(localStorage.getItem("failed-legacy-messages") ?? "[]"));
failed$.subscribe((ids) => localStorage.setItem("failed-legacy-messages", JSON.stringify(ids)));

// Load profiles and relay lists on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, cacheRequest: cache });

// How long a request may wait on a relay, long enough for the user to answer the auth prompt
const RESPONSE_TIMEOUT = 2 * 60_000;

/** A request held by a relay until the user decides whether to authenticate with it */
type AuthRequest = { relay: SyncAuthContext["relay"]; resolve: () => void; reject: (error: unknown) => void };

// Requests waiting on NIP-42 auth, they accumulate until the user answers the prompt
const authRequests$ = new BehaviorSubject<AuthRequest[]>([]);

// Inbox relays often require NIP-42 auth before they return direct messages, so hold the request for the prompt
const onAuthRequired: SyncAuthHandler = ({ relay }) => {
  if (!signer$.value) throw new Error("Sign in to authenticate");
  return new Promise((resolve, reject) => authRequests$.next([...authRequests$.value, { relay, resolve, reject }]));
};

/** Authenticates once with every waiting relay and releases the requests held behind it */
function approveAuth() {
  const signer = signer$.value;
  if (!signer) return cancelAuth();
  const requests = authRequests$.value;
  authRequests$.next([]);
  const auths = new Map<string, Promise<unknown>>();
  for (const { relay, resolve, reject } of requests) {
    if (!auths.has(relay.url)) auths.set(relay.url, relay.authenticate(signer));
    auths.get(relay.url)!.then(() => resolve(), reject);
  }
}

/** Fails every waiting request, their relays report an error instead of loading */
function cancelAuth() {
  const requests = authRequests$.value;
  authRequests$.next([]);
  for (const { reject } of requests) reject(new Error("Authentication cancelled"));
}

// The relay waits on the prompt without its own deadline, the loaders bound the total wait
const auth = { onAuthRequired, authTimeout: false } as const;
const request = (relays: string[], filters: Parameters<RelayPool["request"]>[1]) => pool.request(relays, filters, auth);

const sync = createSyncLoader({ eventStore, pool });

// Publish to the recipient's inboxes chosen by the action, and to our outboxes so our other clients find the message
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  if (storage$.value) await saveEncryptedContent(event, storage$.value);

  const outboxes = await user$.value?.outboxes$.$first(1000, undefined);
  const responses = await pool.publish(mergeRelaySets(relays, outboxes), event);
  if (!responses.some((r) => r.ok)) throw new Error("No relay accepted the event");
});

/** Returns the relays a user reads direct messages from, their NIP-65 inboxes and NIP-17 messaging relays */
function inboxes(user: User): Observable<string[]> {
  return combineLatest([user.inboxes$, user.directMessageRelays$]).pipe(
    map(([inboxes, dm]) => mergeRelaySets(inboxes, dm)),
    ignoreUnhealthyRelays(liveness),
  );
}

/** Returns the relays a user publishes to, their NIP-65 outboxes */
function outboxes(user: User): Observable<string[]> {
  return user.outboxes$.pipe(
    map((relays) => relays ?? []),
    ignoreUnhealthyRelays(liveness),
  );
}

/** Returns where each direction of a user's messages lives: incoming on their inboxes, outgoing on their outboxes */
function mailboxes(user: User) {
  return [
    { relays$: inboxes(user), filter: { kinds: [kinds.EncryptedDirectMessage], "#p": [user.pubkey] } },
    { relays$: outboxes(user), filter: { kinds: [kinds.EncryptedDirectMessage], authors: [user.pubkey] } },
  ];
}

/** Creates a loader for each direction of a user's messages */
function mailboxLoaders(user: User): TimelineLoader[] {
  return mailboxes(user).map(({ relays$, filter }) =>
    createOutboxTimelineLoader(
      request,
      relays$.pipe(map((relays) => Object.fromEntries(relays.map((r) => [r, [user]])))),
      filter,
      { eventStore, cache, liveness, responseTimeout: RESPONSE_TIMEOUT },
    ),
  );
}

/** Returns every message sent or received by a user */
const allMessages = (user: User) => [
  { kinds: [kinds.EncryptedDirectMessage], "#p": [user.pubkey] },
  { kinds: [kinds.EncryptedDirectMessage], authors: [user.pubkey] },
];

/** Restores private plaintext only while the signed-in user's storage is available */
function restoreMessages$(user: User, storage: SecureStorage) {
  return eventStore.filters(allMessages(user)).pipe(restoreEncryptedContentFromCache(storage));
}

/** Decrypts every locked message one at a time, including ones that arrive later */
function decryptMessages(user: User, signer: ISigner, storage: SecureStorage) {
  return eventStore.filters(allMessages(user)).pipe(
    filter((message) => !isEncryptedContentUnlocked(message) && !failed$.value.includes(message.id)),
    concatMap((message) =>
      // Returns the restored content if the cache unlocked the message while it was queued
      defer(() =>
        getOrDecryptEncryptedContent(message, storage, (event) => unlockLegacyMessage(event, user.pubkey, signer)),
      ).pipe(
        map(() => true),
        catchError(() => {
          failed$.next([...failed$.value, message.id]);
          return of(false);
        }),
      ),
    ),
    scan((count, ok) => (ok ? count + 1 : count), 0),
    startWith(0),
  );
}

/** Counts how each stored message was decrypted, the cache restores messages decrypted in earlier visits */
function decryptionStats(user: User) {
  return combineLatest([eventStore.timeline(allMessages(user)).pipe(watchEventsUpdates(eventStore)), failed$]).pipe(
    map(([messages, failed]) => {
      const stats = { total: messages.length, cached: 0, decrypted: 0, locked: 0, failed: 0 };
      for (const message of messages) {
        if (isEncryptedContentUnlocked(message)) {
          if (isEncryptedContentFromCache(message)) stats.cached++;
          else stats.decrypted++;
        } else if (failed.includes(message.id)) stats.failed++;
        else stats.locked++;
      }
      return stats;
    }),
  );
}

/** Creates a loader for one conversation, reading each side's messages from the mailboxes that hold them */
function conversationLoader(self: User, other: User): TimelineLoader {
  // Each relay lists who the messages it holds are addressed to: our inboxes and their outboxes hold messages to us,
  // their inboxes and our outboxes hold messages to them. The filter function turns that into one filter per side
  const map$ = combineLatest([inboxes(self), outboxes(other), inboxes(other), outboxes(self)]).pipe(
    map(([toSelf, fromOther, toOther, fromSelf]) => {
      const relays: Record<string, ProfilePointer[]> = {};
      const add = (relay: string, user: User) => {
        if (!relays[relay]?.includes(user)) (relays[relay] ??= []).push(user);
      };
      for (const relay of [...toSelf, ...fromOther]) add(relay, self);
      for (const relay of [...toOther, ...fromSelf]) add(relay, other);
      return relays;
    }),
  );
  return createOutboxTimelineLoader(
    request,
    map$,
    (users) =>
      users.map((user) => ({
        kinds: [kinds.EncryptedDirectMessage],
        authors: [user.pubkey === self.pubkey ? other.pubkey : self.pubkey],
        "#p": [user.pubkey],
      })),
    { eventStore, cache, liveness, responseTimeout: RESPONSE_TIMEOUT },
  );
}

type History = { statuses: TimelineStatus[]; since: number };

/** Checks that every relay has finished loading the window that starts at since */
const settled = (statuses: TimelineStatus[], since: number) =>
  statuses.length > 0 && statuses.every((s) => s.window.since === since && s.state !== "loading");

/** Loads history backward from start, doubling the window while the end of the list is on screen */
function loadHistory(loaders: TimelineLoader[], start: number, end$: Observable<boolean>): Observable<History> {
  return defer(() => {
    const since$ = new BehaviorSubject(start - 7 * DAY);
    const status$ = combineLatest(loaders.map((loader) => loader.status$)).pipe(map((all) => all.flat()));

    // Reach further back once the current window is loaded and the end of the list is still visible
    const extend$ = combineLatest([status$, since$, end$]).pipe(
      filter(([statuses, since, end]) => end && since > 0 && settled(statuses, since)),
      // Leave the status emission before feeding a new window back into the loader
      observeOn(asapScheduler),
      tap(([, since]) => {
        if (since$.value === since) since$.next(Math.max(0, start - (start - since) * 2));
      }),
    );

    // The loader buffers a page of older messages past the window, so scrolling rarely waits on relays
    const windows$ = since$.pipe(
      distinctUntilChanged(),
      map((since) => ({ since, until: start })),
    );

    return merge(
      combineLatest({ statuses: status$, since: since$ }),
      merge(...loaders.map((loader) => loader(windows$)), extend$).pipe(ignoreElements()),
    );
  });
}

/** Creates a ref callback that reports whether an element is on screen */
function createSentinel() {
  const visible$ = new BehaviorSubject(false);
  const ref = (el: HTMLElement | null) => {
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => visible$.next(entry.isIntersecting));
    observer.observe(el);
    return () => {
      observer.disconnect();
      visible$.next(false);
    };
  };
  return { visible$, ref };
}

const listEnd = createSentinel();
const conversationTop = createSentinel();

const time = (t: number) => new Date(t * 1000).toLocaleString();
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const short = (relay: string) => relay.replace(/^wss:\/\//, "").replace(/\/$/, "");

/** Describes how far back the history has loaded */
function HistoryStatus({ history, empty }: { history?: History; empty: string }) {
  if (!history || !settled(history.statuses, history.since))
    return <span className="loading loading-spinner loading-sm" />;
  if (history.since === 0) return <span>{empty}</span>;
  return <span>Loaded back to {date(history.since)}</span>;
}

function Avatar({ user, size = "size-10" }: { user: User; size?: string }) {
  const profile = use$(user.profile$);
  return (
    <div className="avatar shrink-0">
      <div className={`${size} rounded-full`}>
        <img src={profile?.picture ?? `https://robohash.org/${user.pubkey}.png`} alt="" />
      </div>
    </div>
  );
}

function Name({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <>{profile?.displayName ?? npubEncode(user.pubkey).slice(0, 12)}</>;
}

/** A conversation in the sidebar with a preview of its latest message once it is decrypted */
function ConversationItem({
  user,
  last,
  selected,
  onSelect,
}: {
  user: User;
  last: NostrEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  const preview = use$(() => eventStore.model(EncryptedContentModel, last), [last.id]);

  return (
    <button
      onClick={onSelect}
      className={`flex w-full items-center gap-3 border-b border-base-300 px-3 py-2 text-left hover:bg-base-200 ${selected ? "bg-base-200" : ""}`}
    >
      <Avatar user={user} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">
            <Name user={user} />
          </span>
          <time className="shrink-0 text-sm opacity-60">{new Date(last.created_at * 1000).toLocaleDateString()}</time>
        </div>
        <div className="truncate text-sm opacity-60">{preview ?? "Encrypted message"}</div>
      </div>
    </button>
  );
}

/** The inbox relays and the coverage of the loaded history on each */
function RelayList({ statuses }: { statuses: TimelineStatus[] }) {
  // Inbox relays load received messages and outbox relays load sent ones, a relay can do both
  return (
    <div className="flex flex-col gap-2 p-3">
      <span className="text-sm opacity-70">
        {statuses.length ? `Reading from ${new Set(statuses.map((s) => s.source)).size} relays` : "Finding relays…"}
      </span>
      <ul className="flex flex-col gap-1 text-sm">
        {statuses.map((s) => (
          <li
            key={`${s.source} ${s.filter.authors ? "sent" : "received"}`}
            className="flex justify-between gap-2"
            title={s.error ? String(s.error) : undefined}
          >
            <span className="truncate">{short(s.source)}</span>
            <span className={s.state === "incomplete" ? "text-error" : "opacity-60"}>
              {s.filter.authors ? "sent" : "received"} · {s.state}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Bulk loads every message sent and received in a date range using NIP-77 or paginated requests */
function SyncPanel({ user }: { user: User }) {
  const [span, setSpan] = useState(SYNC_SPANS[1][1]);
  const [run, setRun] = useState<{ since: number }>();

  // Sync received messages from the inboxes and sent messages from the outboxes side by side
  const status = use$(
    () =>
      run &&
      combineLatest(
        mailboxes(user).map(
          ({ relays$, filter }) =>
            sync({ relays: relays$.pipe(take(1)), filter: { ...filter, ...run }, ...auth, timeout: RESPONSE_TIMEOUT })
              .status$,
        ),
      ).pipe(
        map((runs) => ({
          relays: runs.flatMap((r) => Object.values(r.relays)),
          loaded: runs.reduce((sum, r) => sum + r.loaded, 0),
          done: runs.every((r) => r.done),
        })),
      ),
    [run, user],
  );

  const results = status?.relays ?? [];
  const finished = results.filter((r) => r.state === "complete" || r.state === "error").length;
  const failed = results.filter((r) => r.state === "error");
  const running = !!run && !status?.done;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex gap-2">
        <select
          className="select select-sm min-w-0 flex-1"
          value={span}
          onChange={(e) => setSpan(Number(e.target.value))}
          disabled={running}
          aria-label="Sync messages from"
        >
          {SYNC_SPANS.map(([label, value]) => (
            <option key={label} value={value}>
              {label}
            </option>
          ))}
        </select>
        {running ? (
          <button className="btn btn-sm btn-outline" onClick={() => setRun(undefined)}>
            Cancel
          </button>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => setRun({ since: span ? unixNow() - span : 0 })}>
            Sync
          </button>
        )}
      </div>
      {status && (
        <div className="text-sm opacity-70">
          {status.done ? "Synced" : "Syncing"} {status.loaded} messages · {finished}/{results.length} relays
          {failed.map((r, i) => (
            <div key={i} className="truncate text-error" title={r.error?.message}>
              {short(r.relay)}: {r.error?.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({
  user,
  history,
  selected,
  onSelect,
}: {
  user: User;
  history?: History;
  selected?: string;
  onSelect: (pubkey: string) => void;
}) {
  const signer = use$(signer$);

  // One entry per correspondent with their latest message, newest first
  const conversations = use$(
    () =>
      eventStore.timeline(allMessages(user)).pipe(
        map((messages) => {
          const latest = new Map<string, NostrEvent>();
          for (const message of messages) {
            const pubkey = getLegacyMessageCorrespondent(message, user.pubkey);
            if (pubkey && !latest.has(pubkey)) latest.set(pubkey, message);
          }
          return [...latest].map(([pubkey, last]) => ({ user: castUser(pubkey, eventStore), last }));
        }),
      ),
    [user],
  );

  return (
    <aside className="flex w-80 shrink-0 flex-col border-r border-base-300">
      <div className="flex items-center gap-3 border-b border-base-300 p-3">
        <Avatar user={user} size="size-8" />
        <span className="flex-1 truncate font-semibold">
          <Name user={user} />
        </span>
        {!signer && <span className="badge badge-outline">Read only</span>}
        <button className="btn btn-ghost btn-sm" onClick={signOut}>
          Sign out
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversations?.map((c) => (
          <ConversationItem
            key={c.user.pubkey}
            user={c.user}
            last={c.last}
            selected={selected === c.user.pubkey}
            onSelect={() => onSelect(c.user.pubkey)}
          />
        ))}
        <div ref={listEnd.ref} className="p-4 text-center text-sm opacity-60">
          <HistoryStatus history={history} empty={conversations?.length ? "Beginning of your inbox" : "No messages"} />
        </div>
      </div>
    </aside>
  );
}

/** A one line preview of a message, its plaintext once decrypted */
function MessagePreview({ id }: { id: string }) {
  const content = use$(() => eventStore.model(EncryptedContentModel, id), [id]);
  return <span className="truncate">{content ?? "Encrypted message"}</span>;
}

/** A message that shows its plaintext once decrypted, or a button to decrypt it */
function MessageContent({ message, self, onReply }: { message: NostrEvent; self: User; onReply: () => void }) {
  const content = use$(() => eventStore.model(EncryptedContentModel, message), [message.id]);
  const signer = use$(signer$);
  const [error, setError] = useState<string>();

  const decrypt = async () => {
    const signer = signer$.value;
    const storage = storage$.value;
    if (!signer || !storage) return;
    try {
      setError(undefined);
      await getOrDecryptEncryptedContent(message, storage, (event) => unlockLegacyMessage(event, self.pubkey, signer));
      failed$.next(failed$.value.filter((id) => id !== message.id));
    } catch (err) {
      if (!failed$.value.includes(message.id)) failed$.next([...failed$.value, message.id]);
      setError(err instanceof Error ? err.message : "Failed to decrypt");
    }
  };

  if (content !== undefined)
    return (
      <div className="chat-bubble whitespace-pre-wrap wrap-break-words">
        {content}
        {signer && (
          <button
            className="ml-2 cursor-pointer align-middle opacity-0 group-hover:opacity-60 hover:opacity-100"
            onClick={onReply}
            title="Reply"
          >
            ↩
          </button>
        )}
      </div>
    );
  if (!signer) return <div className="chat-bubble opacity-70">🔒 Encrypted</div>;
  return (
    <button className="chat-bubble cursor-pointer opacity-70" onClick={decrypt} title={error}>
      {error ? "Failed to decrypt, retry" : "🔒 Decrypt"}
    </button>
  );
}

function MessageGroup({
  messages,
  self,
  onReply,
}: {
  messages: NostrEvent[];
  self: User;
  onReply: (message: NostrEvent) => void;
}) {
  const own = messages[0].pubkey === self.pubkey;
  const last = messages[messages.length - 1];
  // Each bubble is a direct child of its own chat row so it can grow to the chat's max width
  return (
    <div className="flex flex-col">
      {messages.map((message) => {
        // NIP-04 replies reference their parent with an "e" tag
        const parent = getLegacyMessageParent(message);
        return (
          <div key={message.id} className={`group chat py-0.5 ${own ? "chat-end" : "chat-start"}`}>
            {parent && (
              <div className="chat-header flex max-w-64 gap-1 text-sm opacity-60">
                ↩ <MessagePreview id={parent} />
              </div>
            )}
            <MessageContent message={message} self={self} onReply={() => onReply(message)} />
            {message === last && (
              <div className="chat-footer opacity-60">
                <time className="text-sm">{time(last.created_at)}</time>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Composer({ to, replyTo, onCancelReply }: { to: User; replyTo?: NostrEvent; onCancelReply: () => void }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      setSending(true);
      setError(undefined);
      // Encrypts the message and publishes it to the recipient's inbox relays, replies also tag their parent
      if (replyTo) await actions.run(ReplyToLegacyMessage, replyTo, text.trim());
      else await actions.run(SendLegacyMessage, to.pubkey, text.trim());
      setText("");
      onCancelReply();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  return (
    <form onSubmit={send} className="flex flex-col gap-1 border-t border-base-300 p-3">
      {replyTo && (
        <div className="flex items-center gap-2 border-l-2 border-primary pl-2 text-sm">
          <span className="shrink-0 opacity-60">Replying to</span>
          <MessagePreview id={replyTo.id} />
          <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={onCancelReply}>
            Cancel
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={sending}
          placeholder="Write a message…"
          className="input min-w-0 flex-1"
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !text.trim()}>
          Send
        </button>
      </div>
      {error && <div className="text-sm text-error">{error}</div>}
    </form>
  );
}

function Conversation({ self, other }: { self: User; other: User }) {
  const start = useMemo(() => unixNow(), [self, other]);
  const history = use$(
    () => loadHistory([conversationLoader(self, other)], start, conversationTop.visible$),
    [self, other, start],
  );
  const messages = use$(() => eventStore.model(LegacyMessagesGroup, self.pubkey, other.pubkey), [self, other]) ?? [];
  const signer = use$(signer$);
  const [replyTo, setReplyTo] = useState<NostrEvent>();

  // Group consecutive messages oldest first, then reverse for the bottom anchored list
  const groups = useMemo(() => groupMessageEvents([...messages].reverse()).reverse(), [messages]);

  return (
    <>
      <div className="flex items-center gap-3 border-b border-base-300 px-4 py-3">
        <Avatar user={other} size="size-8" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">
            <Name user={other} />
          </div>
          <div className="truncate text-sm opacity-60">{npubEncode(other.pubkey)}</div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-2 overflow-y-auto p-4">
        {groups.map((group) => (
          <MessageGroup key={group[0].id} messages={group} self={self} onReply={setReplyTo} />
        ))}
        <div ref={conversationTop.ref} className="p-2 text-center text-sm opacity-60">
          <HistoryStatus history={history} empty={messages.length ? "Beginning of conversation" : "No messages yet"} />
        </div>
      </div>

      {signer ? (
        <Composer to={other} replyTo={replyTo} onCancelReply={() => setReplyTo(undefined)} />
      ) : (
        <div className="border-t border-base-300 p-3 text-center opacity-60">
          Read only, sign in to decrypt and reply
        </div>
      )}
    </>
  );
}

/** Decryption cache stats and a button that decrypts every locked message */
function DecryptPanel({ user }: { user: User }) {
  const signer = use$(signer$);
  const storage = use$(storage$);
  const stats = use$(() => decryptionStats(user), [user]);

  // Decrypting prompts the signer, so it only starts when the user asks
  const [decrypting, setDecrypting] = useState(false);
  const decrypted = use$(
    () => (decrypting && signer && storage ? decryptMessages(user, signer, storage) : undefined),
    [decrypting, user, signer, storage],
  );

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap gap-x-3 text-sm opacity-70">
        <span>{stats?.total ?? 0} messages</span>
        <span>{stats?.cached ?? 0} from cache</span>
        <span>{stats?.decrypted ?? 0} decrypted</span>
        <span>{stats?.locked ?? 0} locked</span>
        {!!stats?.failed && <span className="text-error">{stats.failed} failed</span>}
      </div>
      {signer &&
        (decrypting ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span>
              {stats?.locked ? `Decrypting… ${decrypted ?? 0} done` : "Decrypting new messages as they arrive"}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setDecrypting(false)}>
              Stop
            </button>
          </div>
        ) : (
          <button className="btn btn-sm btn-primary" disabled={!stats?.locked} onClick={() => setDecrypting(true)}>
            {stats?.locked ? `Decrypt ${stats.locked} messages` : "All messages decrypted"}
          </button>
        ))}
    </div>
  );
}

/** Asks the user to authenticate with every relay that is holding back a sync or live subscription */
function AuthPrompt() {
  const requests = use$(authRequests$);
  const relays = [...new Set(requests.map((r) => r.relay.url))];
  if (!relays.length) return null;

  return (
    <div role="alert" className="flex flex-col gap-2 p-3">
      <span className="text-sm">
        {relays.length === 1 ? "1 relay requires" : `${relays.length} relays require`} authentication to share direct
        messages
      </span>
      <ul className="text-sm opacity-60">
        {relays.map((relay) => (
          <li key={relay} className="truncate">
            {short(relay)}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button className="btn btn-sm btn-ghost flex-1" onClick={cancelAuth}>
          Cancel
        </button>
        <button className="btn btn-sm btn-primary flex-1" onClick={approveAuth}>
          Authenticate
        </button>
      </div>
    </div>
  );
}

/** A collapsible right drawer with auth, decryption, sync and relay status, so their changes never shift the chat */
function ToolsDrawer({ user, history }: { user: User; history?: History }) {
  const [open, setOpen] = useState(true);
  const auths = use$(authRequests$).length;

  if (!open)
    return (
      <aside className="flex shrink-0 flex-col items-center gap-2 border-l border-base-300 p-2">
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} title="Show sync and decryption">
          «
        </button>
        {auths > 0 && (
          <button className="badge badge-warning" onClick={() => setOpen(true)} title="Relays waiting for auth">
            {auths}
          </button>
        )}
      </aside>
    );

  return (
    <aside className="flex w-80 shrink-0 flex-col divide-y divide-base-300 border-l border-base-300">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="font-semibold">Sync and decryption</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} title="Hide">
          »
        </button>
      </div>
      <AuthPrompt />
      <DecryptPanel user={user} />
      <SyncPanel user={user} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <RelayList statuses={history?.statuses ?? []} />
      </div>
    </aside>
  );
}

function Inbox({ user }: { user: User }) {
  const storage = use$(storage$);
  // Read-only browsing never restores private plaintext
  use$(() => (storage ? restoreMessages$(user, storage) : undefined), [user, storage]);

  const [selected, setSelected] = useState<string>();
  const other = useMemo(() => selected && castUser(selected, eventStore), [selected]);
  const start = useMemo(() => unixNow(), [user]);
  const history = use$(() => loadHistory(mailboxLoaders(user), start, listEnd.visible$), [user, start]);

  // Follow new received and sent messages while the inbox is open
  use$(
    () =>
      merge(
        ...mailboxes(user).map(({ relays$, filter }) =>
          relays$.pipe(
            switchMap((relays) => pool.subscription(relays, { ...filter, since: start }, { eventStore, ...auth })),
          ),
        ),
      ).pipe(ignoreElements()),
    [user, start],
  );

  return (
    <div className="flex min-h-0 grow overflow-hidden">
      <Sidebar user={user} history={history} selected={selected} onSelect={setSelected} />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {other ? (
          <Conversation key={other.pubkey} self={user} other={other} />
        ) : (
          <div className="flex flex-1 items-center justify-center opacity-60">Select a conversation</div>
        )}
      </main>
      <ToolsDrawer user={user} history={history} />
    </div>
  );
}

const signOut = () => {
  cancelAuth();
  // Stop the login view from restoring the account
  forgetActiveAccount();
  // Drop the decrypted messages, the next inbox reloads them from the local cache and restores what its storage holds
  storage$.next(null);
  eventStore.removeByFilters({ kinds: [kinds.EncryptedDirectMessage] });
  signer$.next(null);
  user$.next(null);
};

export default function LegacyMessagesExample() {
  const storage = use$(storage$);
  const signer = use$(signer$);
  const user = use$(user$);

  const handleLogin = (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    user$.next(castUser(pubkey, eventStore));
  };

  if (!user)
    return (
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <div className="flex flex-col gap-2 border-b border-base-300 p-4">
          <span className="font-semibold">Browse an inbox read only</span>
          <span className="text-sm opacity-60">
            NIP-04 messages encrypt their content but not their sender and recipient, so anyone can see who a user is
            messaging
          </span>
          <PubkeyPicker value="" onChange={(pubkey) => pubkey && user$.next(castUser(pubkey, eventStore))} />
        </div>
        <LoginView onLogin={handleLogin} />
      </div>
    );

  // Decrypted messages are stored encrypted, so a signed in user unlocks the storage first
  if (signer && !storage) return <UnlockView onUnlock={(storage) => storage$.next(storage)} />;
  return <Inbox user={user} />;
}
