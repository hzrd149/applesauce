/**
 * A NIP-17 direct message client with a notes to self channel, cached gift wraps, and negentropy inbox sync
 * @tags nip-17, nip-44, nip-59, nip-77, messages, gift-wrap, encryption, dm, sync
 * @related messages/personal-notes, messages/legacy, loader/sync-loader
 */
import { ProxySigner } from "applesauce-accounts";
import { ActionRunner } from "applesauce-actions";
import { SendWrappedMessage } from "applesauce-actions/actions";
import { castUser, User } from "applesauce-common/casts";
import {
  getConversationParticipants,
  getGiftWrapRumor,
  getRumorGiftWraps,
  getRumorSeals,
  groupMessageEvents,
  isGiftWrapUnlocked,
  persistEncryptedContent,
  Rumor,
  unlockGiftWrap,
} from "applesauce-common/helpers";
import { GiftWrapsModel, WrappedMessagesGroup, WrappedMessagesGroups } from "applesauce-common/models";
import { defined, EventStore, mapEventsToStore } from "applesauce-core";
import {
  getDisplayName,
  getExpirationTimestamp,
  getProfilePicture,
  getTagValue,
  isSameURL,
  kinds,
  markFromCache,
  persistEventsToCache,
  type NostrEvent,
  unixNow,
} from "applesauce-core/helpers";
import {
  createEventLoaderForStore,
  createSyncLoader,
  type SyncLoaderStatus,
  type SyncRelayStatus,
} from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useMemo, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  EMPTY,
  filter,
  map,
  Observable,
  of,
  scan,
  startWith,
  switchMap,
  take,
} from "rxjs";

import JsonBlock from "../../components/json-block";
import LoginView from "../../components/login-view";
import NoteContent from "../../components/note-content";
import UnlockView from "../../components/unlock-view";
import SecureStorage from "../../extra/encrypted-storage";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const FALLBACK_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/"];
// NIP-59 randomizes gift wrap timestamps up to two days into the past
const TWO_DAYS = 60 * 60 * 24 * 2;
const DAY = 24 * 60 * 60;
// Startup only reconciles recent messages, older history is synced on demand from the drawer
const STARTUP_SPAN = 30 * DAY;
// How far back the bulk sync can load, zero syncs the whole history
const SYNC_SPANS = [
  ["Last 6 months", 182 * DAY],
  ["Last year", 365 * DAY],
  ["Last 5 years", 5 * 365 * DAY],
  ["All time", 0],
] as const;
const EXPIRATIONS = [
  { label: "Never", seconds: 0 },
  { label: "1 hour", seconds: 60 * 60 },
  { label: "1 day", seconds: 60 * 60 * 24 },
  { label: "1 week", seconds: 60 * 60 * 24 * 7 },
];

const storage$ = new BehaviorSubject<SecureStorage | null>(null);
const signer$ = new BehaviorSubject<ISigner | null>(null);
const user$ = new BehaviorSubject<User | null>(null);

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
const cache = await openDB();

// Gift wraps and profiles are saved to IndexedDB so the next visit only syncs what changed
persistEventsToCache(eventStore, (events) => addEvents(cache, events));
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
  cacheRequest: (filters) => getEventsForFilters(cache, filters),
});

// Decrypted rumors are saved to PIN-encrypted storage so each gift wrap is only decrypted once
persistEncryptedContent(eventStore, storage$.pipe(defined()));

// Gift wraps the signer could not decrypt, remembered so they don't prompt again
const failed$ = new BehaviorSubject<string[]>(JSON.parse(localStorage.getItem("failed-gift-wraps") ?? "[]"));
failed$.subscribe((ids) => localStorage.setItem("failed-gift-wraps", JSON.stringify(ids)));

/** Relay verdicts for the gift wraps of each message sent this session, keyed by rumor id */
type Delivery = { pubkey: string; ok: boolean; error?: string };
const deliveries$ = new BehaviorSubject<Record<string, Delivery[]>>({});

// SendWrappedMessage creates one gift wrap per participant and publishes it to their DM relays.
// It ignores individual publish failures, so record each verdict for the message to show
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  const rumor = getGiftWrapRumor(event);
  const record = (delivery: Omit<Delivery, "pubkey">) => {
    if (!rumor) return;
    const pubkey = getTagValue(event, "p") ?? "";
    deliveries$.next({
      ...deliveries$.value,
      [rumor.id]: [...(deliveries$.value[rumor.id] ?? []), { pubkey, ...delivery }],
    });
  };

  try {
    const responses = await pool.publish(relays?.length ? relays : FALLBACK_RELAYS, event);
    if (!responses.some((r) => r.ok)) throw new Error("No relay accepted the event");
    record({ ok: true });
  } catch (error) {
    record({ ok: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
});

const sync = createSyncLoader({ eventStore, pool });

// DM relays usually require NIP-42 auth before serving kind 1059. Requests from the sync and the live
// subscription accumulate here and both wait (authTimeout: false) until the user approves them
const authRequests$ = new BehaviorSubject<string[]>([]);
function requestAuth({ url }: { url: string }) {
  if (!authRequests$.value.includes(url)) authRequests$.next([...authRequests$.value, url]);
}

/** Reconciles gift wraps since a date with the user's DM relays using NIP-77 where supported */
function syncInbox(user: User, since: number, relays: Observable<string[]>) {
  return sync({
    relays,
    // Reach two days further back because gift wrap timestamps are randomized into the past
    filter: { kinds: [kinds.GiftWrap], "#p": [user.pubkey], since: Math.max(0, since - TWO_DAYS) },
    onAuthRequired: requestAuth,
    authTimeout: false,
  }).status$;
}

/** Loads cached gift wraps, then keeps the last month in sync with the DM relays */
function startInbox(user: User) {
  return defer(async () => {
    // Hydrate the store first so negentropy only downloads gift wraps missing from the cache
    for (const event of (await getEventsForFilters(cache, [
      { kinds: [kinds.GiftWrap], "#p": [user.pubkey] },
    ])) as NostrEvent[]) {
      markFromCache(event);
      eventStore.add(event);
    }
  }).pipe(
    // NIP-17 clients read only from the kind 10050 relays, an observable follows list updates
    switchMap(() =>
      syncInbox(user, unixNow() - STARTUP_SPAN, user.directMessageRelays$.pipe(map((relays) => relays ?? []))),
    ),
  );
}

/** Subscribes to new gift wraps, reaching back two days because wrap timestamps are randomized */
function liveInbox(user: User) {
  return pool
    .subscription(
      user.directMessageRelays$.pipe(map((relays) => relays ?? [])),
      { kinds: [kinds.GiftWrap], "#p": [user.pubkey], since: unixNow() - TWO_DAYS },
      { reconnect: true, onAuthRequired: requestAuth, authTimeout: false },
    )
    .pipe(
      mapEventsToStore(eventStore),
      catchError(() => EMPTY),
    );
}

/** Decrypts every locked gift wrap one at a time, including ones that arrive later */
function decryptInbox(pubkey: string, signer: ISigner) {
  return eventStore.filters({ kinds: [kinds.GiftWrap], "#p": [pubkey] }).pipe(
    filter((gift) => !isGiftWrapUnlocked(gift) && !failed$.value.includes(gift.id)),
    concatMap((gift) =>
      defer(async () => {
        // The gift wrap may have been restored from encrypted storage while it was queued
        if (!isGiftWrapUnlocked(gift)) await unlockGiftWrap(gift, signer);
        return true;
      }).pipe(
        catchError(() => {
          failed$.next([...failed$.value, gift.id]);
          return of(false);
        }),
      ),
    ),
    scan((count, ok) => (ok ? count + 1 : count), 0),
    startWith(0),
  );
}

function formatTime(seconds: number) {
  const date = new Date(seconds * 1000);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { timeStyle: "short" })
    : date.toLocaleDateString();
}

function Avatar({ pubkey, size = "size-10" }: { pubkey: string; size?: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${pubkey}.png`)}
      className={`${size} shrink-0 rounded-full object-cover`}
      alt=""
    />
  );
}

function Name({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return <>{getDisplayName(profile, pubkey.slice(0, 8))}</>;
}

function RelayRow({ url, status }: { url: string; status?: SyncRelayStatus }) {
  const relay = pool.relay(url);
  const icon = use$(relay.icon$);
  const name = use$(relay.name$);
  const authenticated = use$(relay.authenticated$);
  const requested = use$(() => authRequests$.pipe(map((urls) => urls.some((u) => isSameURL(u, url)))), [url]);

  return (
    <div className="flex items-center gap-3">
      <img src={icon} className="size-6 shrink-0 rounded-full bg-base-300" alt="" />
      <span className="min-w-0 flex-1 truncate" title={url}>
        {name || new URL(url).hostname}
      </span>
      {authenticated ? (
        <span className="text-success" title="Authenticated">
          ✓
        </span>
      ) : (
        requested && (
          <span className="text-warning" title="Waiting for sign in">
            !
          </span>
        )
      )}
      <span
        className={`w-12 shrink-0 text-right tabular-nums ${status?.state === "error" ? "text-error" : "text-base-content/60"}`}
        title={status?.error?.message ?? "Gift wraps loaded from this relay"}
      >
        {status?.count ?? 0}
      </span>
    </div>
  );
}

/** The user's DM relays, sync progress, and the decrypt queue */
function InboxStatus({
  user,
  status,
  decrypting,
  decrypted,
  onDecrypt,
}: {
  user: User;
  status?: SyncLoaderStatus;
  decrypting: boolean;
  decrypted?: number;
  onDecrypt: (decrypting: boolean) => void;
}) {
  const relays = use$(user.directMessageRelays$);

  const total = use$(() => eventStore.model(GiftWrapsModel, user.pubkey), [user.pubkey]);
  const locked = use$(
    () =>
      combineLatest([eventStore.model(GiftWrapsModel, user.pubkey, false), failed$]).pipe(
        map(([gifts, failed]) => gifts.filter((gift) => !failed.includes(gift.id))),
      ),
    [user.pubkey],
  );
  const failed = use$(failed$);

  return (
    <section className="flex flex-col gap-3 border-b border-base-300 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Inbox relays</h2>
        <span className="text-sm text-base-content/60">
          {status?.done ? "Last 30 days synced" : "Syncing last 30 days…"}
        </span>
      </div>
      {relays?.length ? (
        relays.map((url) => <RelayRow key={url} url={url} status={status?.relays[url]} />)
      ) : (
        <p className="border-l-2 border-warning pl-3 text-sm">
          No kind 10050 DM relay list found. Other clients won't know where to send you messages.
        </p>
      )}
      <p className="text-sm text-base-content/60">
        {total?.length ?? 0} gift wraps · {locked?.length ?? 0} locked · {failed?.length ?? 0} undecryptable
      </p>
      {decrypting ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span>
            {locked?.length ? `Decrypting… ${decrypted ?? 0} done` : "Decrypting new messages as they arrive"}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => onDecrypt(false)}>
            Stop
          </button>
        </div>
      ) : (
        <button className="btn btn-primary" disabled={!locked?.length} onClick={() => onDecrypt(true)}>
          {locked?.length ? `Decrypt ${locked.length} messages` : "All messages decrypted"}
        </button>
      )}
    </section>
  );
}

/** Bulk loads every gift wrap since a date, the same way startup reconciles the last month */
function SyncPanel({ user }: { user: User }) {
  const [span, setSpan] = useState<number>(SYNC_SPANS[0][1]);
  const [run, setRun] = useState<{ since: number }>();
  const relays = use$(user.directMessageRelays$);
  // Take the current DM relay list so the bulk sync completes instead of following list updates
  const status = use$(
    () => run && syncInbox(user, run.since, user.directMessageRelays$.pipe(defined(), take(1))),
    [run, user],
  );

  const results = Object.values(status?.relays ?? {});
  const finished = results.filter((r) => r.state === "complete" || r.state === "error").length;
  const failed = results.filter((r) => r.state === "error");
  const running = !!run && !status?.done;

  return (
    <section className="flex flex-col gap-2 border-b border-base-300 p-4">
      <h2 className="font-semibold">Sync older messages</h2>
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
          <button
            className="btn btn-sm btn-primary"
            disabled={!relays?.length}
            onClick={() => setRun({ since: span ? unixNow() - span : 0 })}
          >
            Sync
          </button>
        )}
      </div>
      {status && (
        <div className="text-sm text-base-content/60">
          {status.done ? "Synced" : "Syncing"} {status.loaded} gift wraps · {finished}/{results.length} relays
          {failed.map((r) => (
            <p key={r.relay} className="truncate text-error" title={r.error?.message}>
              {new URL(r.relay).hostname}: {r.error?.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** The accumulated NIP-42 auth requests, approved by the user instead of signing automatically */
function AuthRequests({ signer }: { signer: ISigner }) {
  const requests = use$(authRequests$);
  const [pending, setPending] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!requests?.length) return null;

  const approve = async (urls: string[]) => {
    setPending((p) => [...p, ...urls]);
    await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await pool.relay(url).authenticate(signer);
          if (!response.ok) throw new Error(response.message ?? "Rejected by relay");
          authRequests$.next(authRequests$.value.filter((u) => u !== url));
        } catch (err) {
          setErrors((e) => ({ ...e, [url]: err instanceof Error ? err.message : String(err) }));
        } finally {
          setPending((p) => p.filter((u) => u !== url));
        }
      }),
    );
  };

  return (
    <section className="flex flex-col gap-2 border-b border-base-300 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">Sign in to relays</h2>
        {requests.length > 1 && (
          <button className="btn btn-sm" disabled={pending.length > 0} onClick={() => approve(requests)}>
            Approve all
          </button>
        )}
      </div>
      <p className="text-sm text-base-content/60">These relays require NIP-42 authentication to read your messages.</p>
      {requests.map((url) => (
        <div key={url} className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{new URL(url).hostname}</p>
            {errors[url] && <p className="text-sm text-error">{errors[url]}</p>}
          </div>
          <button className="btn btn-primary btn-sm" disabled={pending.includes(url)} onClick={() => approve([url])}>
            {pending.includes(url) ? <span className="loading loading-spinner loading-sm" /> : "Approve"}
          </button>
        </div>
      ))}
    </section>
  );
}

function ConversationRow({
  self,
  participants,
  lastMessage,
  selected,
  onSelect,
}: {
  self: string;
  participants: string[];
  lastMessage?: Rumor;
  selected: boolean;
  onSelect: () => void;
}) {
  const others = participants.filter((p) => p !== self);

  return (
    <button
      className={`flex w-full items-center gap-3 border-s-2 px-4 py-2 text-left ${selected ? "border-primary bg-base-200" : "border-transparent hover:bg-base-200"}`}
      onClick={onSelect}
    >
      {others.length ? (
        <Avatar pubkey={others[0]} />
      ) : (
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-base-300">✎</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-medium">
            {others.length
              ? others.map((p, i) => (
                  <span key={p}>
                    {i > 0 && ", "}
                    <Name pubkey={p} />
                  </span>
                ))
              : "Notes to self"}
          </span>
          {lastMessage && (
            <span className="shrink-0 text-sm text-base-content/50">{formatTime(lastMessage.created_at)}</span>
          )}
        </div>
        <p className="truncate text-sm text-base-content/60">
          {lastMessage ? lastMessage.content : "Private notes only you can read"}
        </p>
      </div>
    </button>
  );
}

function ConversationList({
  self,
  selected,
  onSelect,
}: {
  self: string;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const groups = use$(() => eventStore.model(WrappedMessagesGroups, self), [self]);
  const conversations = useMemo(
    () =>
      (groups ?? []).filter((c) => c.id !== self).sort((a, b) => b.lastMessage.created_at - a.lastMessage.created_at),
    [groups, self],
  );
  // A conversation with only yourself is the notes to self channel, pinned to the top
  const notes = groups?.find((c) => c.id === self);

  return (
    <nav className="min-h-0 flex-1 overflow-y-auto">
      <ConversationRow
        self={self}
        participants={[self]}
        lastMessage={notes?.lastMessage}
        selected={selected === self}
        onSelect={() => onSelect(self)}
      />
      {conversations.map((c) => (
        <ConversationRow
          key={c.id}
          self={self}
          participants={c.participants}
          lastMessage={c.lastMessage}
          selected={selected === c.id}
          onSelect={() => onSelect(c.id)}
        />
      ))}
      {groups && conversations.length === 0 && (
        <p className="p-4 text-sm text-base-content/60">No conversations yet.</p>
      )}
    </nav>
  );
}

/** Warns when a recipient has no kind 10050 list and the message falls back to their NIP-65 inboxes */
function RecipientRelays({ pubkey }: { pubkey: string }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  const dmRelays = use$(user.directMessageRelays$);
  const inboxes = use$(user.inboxes$);

  return (
    <span className={`text-sm ${dmRelays?.length ? "text-base-content/60" : "text-warning"}`}>
      <Name pubkey={pubkey} />:{" "}
      {dmRelays?.length
        ? `${dmRelays.length} DM relays`
        : inboxes?.length
          ? `no DM relays, falling back to ${inboxes.length} inboxes`
          : "no DM relays found"}
    </span>
  );
}

function Message({ message, own, onInspect }: { message: Rumor; own: boolean; onInspect: () => void }) {
  const deliveries = use$(() => deliveries$.pipe(map((all) => all[message.id])), [message.id]);
  const failures = deliveries?.filter((d) => !d.ok) ?? [];
  const expiration = getRumorGiftWraps(message).map(getExpirationTimestamp).find(Boolean);

  return (
    <div className={`flex flex-col ${own ? "items-end" : "items-start"}`}>
      <div className={`chat-bubble ${own ? "chat-bubble-primary" : ""}`}>
        <NoteContent event={message} />
      </div>
      <div className="flex gap-2 px-1 text-sm text-base-content/50">
        <button className="hover:underline" onClick={onInspect}>
          {formatTime(message.created_at)}
        </button>
        {expiration && <span>expires {formatTime(expiration)}</span>}
        {own && deliveries && (
          <span
            className={failures.length ? "text-error" : ""}
            title={failures.map((f) => f.error).join("\n") || undefined}
          >
            {failures.length ? `${failures.length} of ${deliveries.length} not delivered` : "delivered"}
          </span>
        )}
      </div>
    </div>
  );
}

/** Shows the rumor, seal, and gift wrap layers of a message */
function Inspector({ message, onClose }: { message: Rumor; onClose: () => void }) {
  return (
    <dialog
      className="modal"
      ref={(node) => {
        if (node && !node.open) node.showModal();
      }}
      onClose={onClose}
    >
      <div className="modal-box flex max-w-4xl flex-col gap-3">
        <h3 className="text-lg font-semibold">Rumor (unsigned kind 14)</h3>
        <JsonBlock value={message} />
        <h3 className="text-lg font-semibold">Seal (kind 13, signed by the author)</h3>
        <JsonBlock value={getRumorSeals(message)[0]} />
        <h3 className="text-lg font-semibold">Gift wrap (kind 1059, signed by a random key)</h3>
        <JsonBlock value={getRumorGiftWraps(message)[0]} />
      </div>
      <form method="dialog" className="modal-backdrop">
        <button>close</button>
      </form>
    </dialog>
  );
}

function Composer({ conversation, placeholder }: { conversation: string; placeholder: string }) {
  const [text, setText] = useState("");
  const [expiration, setExpiration] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      // NIP-40 expiration tags let relays delete the gift wraps after the chosen time
      await actions.run(SendWrappedMessage, getConversationParticipants(conversation), text.trim(), {
        expiration: expiration ? unixNow() + expiration : undefined,
      });
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-t border-base-300 p-4">
      <div className="flex items-end gap-2">
        <textarea
          className="textarea min-h-12 min-w-0 flex-1"
          rows={1}
          placeholder={placeholder}
          value={text}
          disabled={sending}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <select
          className="select w-32"
          title="Disappearing messages"
          value={expiration}
          onChange={(e) => setExpiration(Number(e.target.value))}
        >
          {EXPIRATIONS.map((option) => (
            <option key={option.label} value={option.seconds}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!text.trim() || sending} onClick={send}>
          {sending ? <span className="loading loading-spinner loading-sm" /> : "Send"}
        </button>
      </div>
      {error && <p className="text-sm text-error">{error}</p>}
    </div>
  );
}

function Conversation({ self, conversation }: { self: string; conversation: string }) {
  const messages = use$(
    () => eventStore.model(WrappedMessagesGroup, self, getConversationParticipants(conversation)),
    [self, conversation],
  );
  // Messages are newest first, so groups and bubbles render in a reversed column
  const groups = useMemo(() => groupMessageEvents(messages ?? []), [messages]);
  const [inspecting, setInspecting] = useState<Rumor | null>(null);
  const others = getConversationParticipants(conversation).filter((p) => p !== self);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-base-300 p-4">
        <h2 className="text-xl font-semibold">
          {others.length
            ? others.map((p, i) => (
                <span key={p}>
                  {i > 0 && ", "}
                  <Name pubkey={p} />
                </span>
              ))
            : "Notes to self"}
        </h2>
        {others.length ? (
          <div className="flex flex-wrap gap-x-4">
            {others.map((p) => (
              <RecipientRelays key={p} pubkey={p} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-base-content/60">
            Gift wrapped to yourself and stored on your DM relays, readable from any NIP-17 client
          </p>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col-reverse gap-4 overflow-y-auto p-4">
        {groups.map((group) => {
          const own = group[0].pubkey === self;
          return (
            <div key={group[0].id} className={`flex gap-3 ${own ? "flex-row-reverse" : ""}`}>
              {others.length > 0 && <Avatar pubkey={group[0].pubkey} />}
              <div className="flex min-w-0 max-w-[70%] flex-col-reverse gap-1">
                {group.map((message) => (
                  <Message key={message.id} message={message} own={own} onInspect={() => setInspecting(message)} />
                ))}
              </div>
            </div>
          );
        })}
        {messages?.length === 0 && (
          <p className="m-auto text-base-content/60">
            {others.length ? "No messages yet. Say hello." : "Write a note to keep it private and synced."}
          </p>
        )}
      </div>

      <Composer conversation={conversation} placeholder={others.length ? "Message…" : "Write a note…"} />
      {inspecting && <Inspector message={inspecting} onClose={() => setInspecting(null)} />}
    </main>
  );
}

function Inbox({ user, signer }: { user: User; signer: ISigner }) {
  const profile = use$(user.profile$);
  const [conversation, setConversation] = useState(user.pubkey);
  const [drawer, setDrawer] = useState(true);

  // The inbox streams live here so collapsing the drawer doesn't stop syncing or decrypting
  const status = use$(() => startInbox(user), [user]);
  use$(() => liveInbox(user), [user]);
  const authRequests = use$(authRequests$);

  // Decrypting prompts the signer, so it only starts when the user asks
  const [decrypting, setDecrypting] = useState(false);
  const decrypted = use$(
    () => (decrypting ? decryptInbox(user.pubkey, signer) : of(undefined)),
    [decrypting, user, signer],
  );

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-80 shrink-0 flex-col border-e border-base-300">
        <div className="flex items-center gap-3 border-b border-base-300 p-4">
          <Avatar pubkey={user.pubkey} />
          <div className="min-w-0">
            <p className="text-sm text-base-content/60">DIRECT MESSAGES</p>
            <h1 className="truncate text-xl font-semibold">{getDisplayName(profile, user.npub.slice(0, 12))}</h1>
          </div>
        </div>
        <ConversationList self={user.pubkey} selected={conversation} onSelect={setConversation} />
      </aside>
      <Conversation key={conversation} self={user.pubkey} conversation={conversation} />
      <aside className="flex shrink-0 border-s border-base-300">
        <div className="flex flex-col items-center gap-2 p-2">
          <button
            className="btn btn-ghost btn-square"
            title={drawer ? "Collapse inbox status" : "Expand inbox status"}
            onClick={() => setDrawer(!drawer)}
          >
            {drawer ? "»" : "«"}
          </button>
          {!drawer && !status?.done && <span className="loading loading-spinner loading-sm" title="Syncing" />}
          {!drawer && !!authRequests?.length && (
            <span className="badge badge-warning" title="Relays waiting for sign in">
              {authRequests.length}
            </span>
          )}
        </div>
        {drawer && (
          <div className="flex w-72 flex-col overflow-y-auto border-s border-base-300">
            <InboxStatus
              user={user}
              status={status}
              decrypting={decrypting}
              decrypted={decrypted}
              onDecrypt={setDecrypting}
            />
            <AuthRequests signer={signer} />
            <SyncPanel user={user} />
          </div>
        )}
      </aside>
    </div>
  );
}

export default function DirectMessagesExample() {
  const storage = use$(storage$);
  const signer = use$(signer$);
  const user = use$(user$);

  // Unlock the encrypted storage first so decrypted messages restore before any gift wraps load
  if (!storage)
    return (
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <UnlockView onUnlock={(storage) => storage$.next(storage)} />
      </div>
    );

  if (!signer || !user)
    return (
      <div className="flex min-h-0 grow flex-col overflow-y-auto">
        <LoginView
          onLogin={(signer, pubkey) => {
            signer$.next(signer);
            user$.next(castUser(pubkey, eventStore));
          }}
        />
      </div>
    );

  return <Inbox key={user.pubkey} user={user} signer={signer} />;
}
