/**
 * A thread activity dashboard that syncs every NIP-10 and NIP-22 thread the signed in user is part of with NIP-77 and measures how fast each sync step completes
 * @tags nip-77, negentropy, nip-10, nip-22, nip-65, notifications, threads, dashboard, sync, actions
 * @related notifications/mentions, notifications/zaps, loader/sync-loader, threading/note-thread
 */
import "applesauce-content/text/cashu";
import "applesauce-content/text/lightning";
import { ProxySigner } from "applesauce-accounts";
import { type Action, ActionRunner } from "applesauce-actions";
import { castUser, type User } from "applesauce-common/casts";
import { CommentFactory, NoteFactory } from "applesauce-common/factories";
import {
  COMMENT_KIND,
  getCommentReplyPointer,
  getCommentRootPointer,
  getNip10References,
  type CommentPointer,
} from "applesauce-common/helpers";
import { defined, EventStore } from "applesauce-core";
import {
  createReplaceableAddress,
  fakeVerifyEvent,
  getDisplayName,
  getOrComputeCachedValue,
  getProfilePicture,
  getReplaceableAddressFromPointer,
  getSeenRelays,
  kinds,
  markFromCache,
  persistEventsToCache,
  relaySet,
  unixNow,
  type AddressPointer,
  type DecodeResult,
  type EventPointer,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import {
  createEventLoaderForStore,
  createSyncLoader,
  type SyncLoaderStatus,
  type SyncLoadRequest,
  type SyncRelayState,
} from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { MessagesSquare, Reply } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { type FormEvent, Fragment, useMemo, useState } from "react";
import {
  auditTime,
  BehaviorSubject,
  catchError,
  concatWith,
  defer,
  EMPTY,
  first,
  ignoreElements,
  map,
  merge,
  type Observable,
  scan,
  shareReplay,
  switchMap,
  tap,
} from "rxjs";
import LoginView from "../../components/login-view";
import { publishEvent } from "../../extra/publish";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

/** Skips signature verification for cached events, they were verified by the event store before they were saved */
function trustCached(events: NostrEvent[]) {
  for (const event of events) fakeVerifyEvent(event);
  return events;
}

// The default nostr-idb IndexedDB database, shared with the other cache examples
const cache = await openDB();
persistEventsToCache(eventStore, (events) => addEvents(cache, events));

createEventLoaderForStore(eventStore, pool, {
  cacheRequest: (filters) => getEventsForFilters<NostrEvent>(cache, filters).then(trustCached),
  lookupRelays: lookupRelays$,
});

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

const THREAD_KINDS = [kinds.ShortTextNote, COMMENT_KIND];
// Popular relays synced alongside the user's inboxes, since not every client publishes to the inboxes
const EXTRA_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const PAGE_SIZE = 50;
const DAY = 86400;

/** A range from a number of days ago up to now */
type Range = { since: number; days: number };
type RelayRow = { relay: string; state: SyncRelayState; methods: Set<string>; count: number; error?: string };
type SyncSummary = {
  relays: RelayRow[];
  negentropy: number;
  failed: number;
  events: number;
  done: boolean;
  /** Milliseconds from the start of the step to the first received event */
  first?: number;
  /** Milliseconds from the start of the step to the last status change */
  elapsed: number;
};
type LoadMessage = { key: string; status: SyncLoaderStatus } | { key: string; event: NostrEvent };

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const range$ = new BehaviorSubject<Range>({ since: unixNow() - 30 * DAY, days: 30 });

// The runner follows the signed in account and saves published replies to the store so the UI updates instantly
const actions = new ActionRunner(eventStore, new ProxySigner(signer$.pipe(defined())), async (event, relays) => {
  await publishEvent(pool, relays?.length ? relays : EXTRA_RELAYS, event);
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const hydrated = new Map<string, Observable<never>>();

/** Loads the cached events matching a filter into the store once, so negentropy only syncs what the cache is missing */
function hydrate(filter: Filter): Observable<never> {
  const key = JSON.stringify(filter);
  let hydrate$ = hydrated.get(key);
  if (!hydrate$) {
    hydrate$ = defer(() => getEventsForFilters<NostrEvent>(cache, [filter])).pipe(
      tap((events) => {
        for (const event of events) {
          markFromCache(event);
          fakeVerifyEvent(event);
          eventStore.add(event);
        }
      }),
      ignoreElements(),
      catchError(() => EMPTY),
      shareReplay(1),
    );
    hydrated.set(key, hydrate$);
  }
  return hydrate$;
}

/** Hydrates the filter from the cache, then runs a single sync load and tags its messages with a key */
function load(key: string, request: SyncLoadRequest): Observable<LoadMessage> {
  return hydrate(request.filter).pipe(
    concatWith(
      defer(() => {
        const { status$, events$ } = syncLoader(request);
        return merge(status$.pipe(map((status) => ({ key, status }))), events$.pipe(map((event) => ({ key, event }))));
      }),
    ),
  );
}

/** Syncs every filter from a growing relay list, the loader starts new relays without restarting the others */
function syncFilters(relays$: Observable<string[]>, filters: Filter[], prefix: string): Observable<LoadMessage> {
  return merge(...filters.map((filter, i) => load(`${prefix}:${i}`, { relays: relays$, filter })));
}

/** Reduces the messages of many loads into a per-relay summary with timings */
function summarize(messages$: Observable<LoadMessage>): Observable<SyncSummary> {
  return defer(() => {
    const start = Date.now();
    return messages$.pipe(
      scan(
        (state, message) => {
          state.last = Date.now();
          if ("status" in message) state.statuses.set(message.key, message.status);
          else {
            state.first ??= state.last - start;
            state.events.add(message.event.id);
          }
          return state;
        },
        {
          statuses: new Map<string, SyncLoaderStatus>(),
          events: new Set<string>(),
          first: undefined as number | undefined,
          last: start,
        },
      ),
      auditTime(100),
      map(({ statuses, events, first, last }): SyncSummary => {
        const all = [...statuses.values()];
        const rows = new Map<string, RelayRow>();
        for (const status of all)
          for (const r of Object.values(status.relays)) {
            const row = rows.get(r.relay) ?? { relay: r.relay, state: r.state, methods: new Set(), count: 0 };
            if (r.method) row.methods.add(r.method);
            row.count += r.count;
            // A relay is only as finished as its slowest load
            if (r.state === "error") {
              row.state = "error";
              row.error = r.error?.message;
            } else if (row.state !== "error" && r.state !== "complete") row.state = r.state;
            rows.set(r.relay, row);
          }
        const relays = [...rows.values()];
        return {
          relays,
          negentropy: relays.filter((r) => r.methods.has("negentropy")).length,
          failed: relays.filter((r) => r.state === "error").length,
          events: events.size,
          done: all.every((status) => status.done),
          first,
          elapsed: last - start,
        };
      }),
    );
  });
}

const inRange = (filter: Filter, range: Range): Filter => ({ ...filter, since: range.since });

/** Every note and comment the user published, the source of truth for which threads they are part of */
const mineFilter = (pubkey: string): Filter => ({ kinds: THREAD_KINDS, authors: [pubkey] });
/** Every note and comment that tags the user, which covers replies from clients that follow NIP-10 and NIP-22 */
const inboundFilter = (pubkey: string): Filter => ({ kinds: THREAD_KINDS, "#p": [pubkey] });

/** Step 1: syncs the user's own notes and comments from their outboxes */
function mineSync$(user: User, range: Range): Observable<SyncSummary> {
  return summarize(syncFilters(user.outboxes$.pipe(defined()), [inRange(mineFilter(user.pubkey), range)], "mine"));
}

/** Step 2: syncs everything that tags the user from their inboxes and the extra relays */
function inboundSync$(user: User, range: Range): Observable<SyncSummary> {
  // Each emission is the full relay list, so the extra relays are kept when the inboxes load
  const relays$ = user.inboxes$.pipe(map((inboxes) => relaySet(EXTRA_RELAYS, inboxes)));
  return summarize(syncFilters(relays$, [inRange(inboundFilter(user.pubkey), range)], "inbound"));
}

/** Subscribes to new notes and comments from the user and to the user */
function live$(user: User) {
  const since = unixNow();
  return merge(
    user.outboxes$.pipe(
      defined(),
      switchMap((outboxes) => pool.subscription(outboxes, { ...mineFilter(user.pubkey), since }, { eventStore })),
    ),
    user.inboxes$.pipe(
      defined(),
      switchMap((inboxes) =>
        pool.subscription(relaySet(inboxes, EXTRA_RELAYS), { ...inboundFilter(user.pubkey), since }, { eventStore }),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** The root of a NIP-10 or NIP-22 thread, keyed the same way replies reference it */
type Root =
  | { type: "event"; key: string; pointer: EventPointer }
  | { type: "address"; key: string; pointer: AddressPointer }
  | { type: "external"; key: string };

/** A thread the user is part of and its activity within the range */
type ThreadActivity = {
  key: string;
  root: Root;
  /** Every event in the thread within the range, newest first */
  events: NostrEvent[];
  /** The events by other users, newest first */
  replies: NostrEvent[];
  participants: string[];
};

/** Returns a key for a NIP-22 pointer, matching how replies reference their parent */
function getCommentPointerKey(pointer: CommentPointer): string {
  if (pointer.type === "event") return pointer.id;
  if (pointer.type === "address") return createReplaceableAddress(pointer.kind, pointer.pubkey, pointer.identifier);
  return pointer.identifier;
}

/** Returns the key replies use to reference an event */
function getEventKey(event: NostrEvent): string {
  return kinds.isAddressableKind(event.kind)
    ? createReplaceableAddress(event.kind, event.pubkey, event.tags.find((t) => t[0] === "d")?.[1])
    : event.id;
}

const RootSymbol = Symbol("thread-root");

/** Finds the root of an event's thread, a note without a root is the root of its own thread */
function getRoot(event: NostrEvent): Root {
  return getOrComputeCachedValue(event, RootSymbol, (): Root => {
    if (event.kind === COMMENT_KIND) {
      const root = getCommentRootPointer(event);
      if (root?.type === "event")
        return {
          type: "event",
          key: root.id,
          pointer: { id: root.id, author: root.pubkey, relays: relaySet(root.relay) },
        };
      if (root?.type === "address")
        return {
          type: "address",
          key: getCommentPointerKey(root),
          pointer: { kind: root.kind, pubkey: root.pubkey, identifier: root.identifier, relays: relaySet(root.relay) },
        };
      if (root?.type === "external") return { type: "external", key: root.identifier };
    } else {
      const root = getNip10References(event).root;
      if (root?.e) return { type: "event", key: root.e.id, pointer: root.e };
      if (root?.a) return { type: "address", key: getReplaceableAddressFromPointer(root.a), pointer: root.a };
    }
    return { type: "event", key: event.id, pointer: { id: event.id, author: event.pubkey } };
  });
}

/** Returns the author of the root when the pointer includes it */
function getRootAuthor(root: Root): string | undefined {
  if (root.type === "event") return root.pointer.author;
  if (root.type === "address") return root.pointer.pubkey;
}

/** Returns the key of the event a reply responds to */
function getParentKey(event: NostrEvent): string | undefined {
  if (event.kind === COMMENT_KIND) {
    const parent = getCommentReplyPointer(event);
    return parent ? getCommentPointerKey(parent) : undefined;
  }
  const reply = getNip10References(event).reply;
  return reply?.e?.id ?? (reply?.a && getReplaceableAddressFromPointer(reply.a));
}

/** Returns the author of the event a reply responds to, falling back to the parent event in the store */
function getParentAuthor(event: NostrEvent): string | undefined {
  if (event.kind === COMMENT_KIND) {
    const parent = getCommentReplyPointer(event);
    if (parent?.type === "address") return parent.pubkey;
    if (parent?.type === "event" && parent.pubkey) return parent.pubkey;
    // NIP-22 uses the lowercase "p" tag for the parent author
    return event.tags.find((t) => t[0] === "p")?.[1];
  }
  const reply = getNip10References(event).reply;
  if (reply?.a) return reply.a.pubkey;
  if (reply?.e) return reply.e.author ?? eventStore.getEvent(reply.e.id)?.pubkey;
}

/** Groups events by thread and keeps the threads the user started, replied in or was replied to in */
function getThreads(events: NostrEvent[], pubkey: string): ThreadActivity[] {
  const groups = new Map<string, NostrEvent[]>();
  for (const event of events) {
    const key = getRoot(event).key;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  const threads: ThreadActivity[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => b.created_at - a.created_at);
    const root = getRoot(list[0]);
    const rootAuthor = list.find((e) => getEventKey(e) === key)?.pubkey ?? getRootAuthor(root);
    const mine = list.filter((e) => e.pubkey === pubkey);
    if (rootAuthor !== pubkey && mine.length === 0 && !list.some((e) => getParentAuthor(e) === pubkey)) continue;

    const replies = list.filter((e) => e.pubkey !== pubkey);
    threads.push({
      key,
      root,
      events: list,
      replies,
      participants: [...new Set(replies.map((e) => e.pubkey))],
    });
  }

  // Most recent activity first
  return threads.sort((a, b) => b.events[0].created_at - a.events[0].created_at);
}

/** Every thread in the store the user is part of within the range */
function threads$(pubkey: string, range: Range): Observable<ThreadActivity[]> {
  return eventStore.timeline({ kinds: THREAD_KINDS, since: range.since }).pipe(
    auditTime(200),
    map((events) => getThreads(events, pubkey)),
  );
}

/** The filters for the root of a thread and every reply to it */
function threadFilters(root: Root): Filter[] {
  if (root.type === "event")
    return [
      { ids: [root.key] },
      { kinds: [kinds.ShortTextNote], "#e": [root.key] },
      { kinds: [COMMENT_KIND], "#E": [root.key] },
    ];
  if (root.type === "address")
    return [
      { kinds: [root.pointer.kind], authors: [root.pointer.pubkey], "#d": [root.pointer.identifier] },
      { kinds: [kinds.ShortTextNote], "#a": [root.key] },
      { kinds: [COMMENT_KIND], "#A": [root.key] },
    ];
  return [{ kinds: [COMMENT_KIND], "#I": [root.key] }];
}

/** Syncs the full history of a single thread from its relay hints, the user's inboxes and the extra relays */
function threadSync$(thread: ThreadActivity, user: User): Observable<SyncSummary> {
  const hints = thread.root.type === "external" ? [] : (thread.root.pointer.relays ?? []);
  const seen = thread.events.flatMap((e) => [...(getSeenRelays(e) ?? [])]);
  const relays$ = user.inboxes$.pipe(map((inboxes) => relaySet(hints, seen, EXTRA_RELAYS, inboxes)));
  return summarize(syncFilters(relays$, threadFilters(thread.root), `thread:${thread.key}`));
}

/** Groups the thread events by parent, attaching replies to missing events to the root so nothing is hidden */
function buildTree(key: string, events: NostrEvent[]) {
  const keys = new Set(events.map(getEventKey));
  const children = new Map<string, NostrEvent[]>();
  let root: NostrEvent | undefined;

  for (const event of [...events].sort((a, b) => a.created_at - b.created_at)) {
    if (getEventKey(event) === key) {
      root = event;
      continue;
    }
    let parent = getParentKey(event) ?? key;
    if (parent !== key && !keys.has(parent)) parent = key;
    children.set(parent, [...(children.get(parent) ?? []), event]);
  }

  return { root, children };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Replies with a NIP-10 note to notes and a NIP-22 comment to everything else, published to the tagged users' inboxes */
function ReplyTo(parent: NostrEvent, content: string): Action {
  return async ({ signer, user, publish }) => {
    if (!signer) throw new Error("Missing signer");
    const factory =
      parent.kind === kinds.ShortTextNote ? NoteFactory.reply(parent, content) : CommentFactory.reply(parent, content);
    const reply = await factory.sign(signer);

    const tagged = [...new Set(reply.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]))];
    const inboxes = await Promise.all(
      tagged.map((pubkey) => castUser(pubkey, eventStore).inboxes$.$first(1_000, undefined)),
    );
    // The outboxes are included so the reply is found by the next sync of the user's own events
    const outboxes = await user.outboxes$.$first(1_000, undefined);
    await publish(reply, relaySet(...inboxes, outboxes));
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const contentCache = Symbol("threads-note-content");

const components: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a className="link" href={node.href} target="_blank" rel="noopener noreferrer">
      {node.value}
    </a>
  ),
  mention: ({ node }) => (
    <a className="link" href={`https://njump.me/${node.encoded}`} target="_blank" rel="noopener noreferrer">
      <MentionLabel pointer={node.decoded} encoded={node.encoded} />
    </a>
  ),
  hashtag: ({ node }) => <span>#{node.name}</span>,
  emoji: ({ node }) => (
    <img src={node.url} alt={node.raw} title={node.raw} className="inline-block h-5 w-5" loading="lazy" />
  ),
  gallery: ({ node }) => (
    <>
      {node.links.map((url) => (
        <a key={url} className="link block" href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      ))}
    </>
  ),
  blossom: ({ node }) => <span className="break-all">{node.raw}</span>,
  cashu: ({ node }) => <span className="break-all">{node.raw}</span>,
  lightning: ({ node }) => (
    <a className="link break-all" href={`lightning:${node.invoice}`}>
      {node.invoice}
    </a>
  ),
};

// The side list renders inside a button, so links become plain text
const previewComponents: ComponentMap = {
  ...components,
  link: ({ node }) => <span className="text-primary break-all">{node.value}</span>,
  mention: ({ node }) => (
    <span className="text-primary">
      <MentionLabel pointer={node.decoded} encoded={node.encoded} />
    </span>
  ),
  gallery: ({ node }) => <span className="text-primary">[{node.links.length} media]</span>,
  lightning: () => <span className="text-primary">[lightning invoice]</span>,
};

function NoteContent({ event }: { event: NostrEvent }) {
  const content = useRenderedContent(event, components, { cacheKey: contentCache });
  return <div className="whitespace-pre-wrap break-words">{content}</div>;
}

function NotePreview({ event, maxLength = 160 }: { event: NostrEvent; maxLength?: number }) {
  const content = useRenderedContent(event, previewComponents, { cacheKey: contentCache, maxLength });
  return <div className="whitespace-pre-wrap break-words text-sm text-base-content/80">{content}</div>;
}

/** Returns the pubkey of a decoded npub or nprofile */
function getMentionPubkey(pointer: DecodeResult): string | undefined {
  if (pointer.type === "npub") return pointer.data;
  if (pointer.type === "nprofile") return pointer.data.pubkey;
}

/** Resolves npub and nprofile mentions to the user's name, other NIP-19 pointers stay encoded */
function MentionLabel({ pointer, encoded }: { pointer: DecodeResult; encoded: string }) {
  const pubkey = getMentionPubkey(pointer);
  const profile = use$(() => (pubkey ? castUser(pubkey, eventStore).profile$ : undefined), [pubkey]);
  if (!pubkey) return <>nostr:{encoded.slice(0, 16)}…</>;
  return <>@{getDisplayName(profile, pubkey.slice(0, 8))}</>;
}

const timeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Formats a timestamp relative to now within a week, then as a date */
function when(unix: number) {
  const seconds = unix - unixNow();
  if (Math.abs(seconds) > 7 * DAY) return dateFormat.format(new Date(unix * 1000));
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", DAY],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return timeFormat.format(Math.round(seconds / size), unit);
  return "just now";
}

const ms = (value?: number) => (value === undefined ? "–" : `${(value / 1000).toFixed(2)}s`);

function Avatar({ pubkey, size = "size-8" }: { pubkey: string; size?: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${pubkey}`)}
      className={`${size} rounded-full bg-base-200 shrink-0 border border-base-100`}
    />
  );
}

function Name({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return <span className="font-semibold">{getDisplayName(profile, pubkey.slice(0, 8))}</span>;
}

const PRESETS = [7, 30, 90];

function RangePicker({ range }: { range: Range }) {
  return (
    <div className="join">
      {PRESETS.map((days) => (
        <button
          key={days}
          className={`btn btn-sm join-item ${range.days === days ? "btn-active" : ""}`}
          onClick={() => range$.next({ since: unixNow() - days * DAY, days })}
        >
          {days}d
        </button>
      ))}
    </div>
  );
}

function SyncStatus({ summary }: { summary?: SyncSummary }) {
  if (!summary) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-base-content/60">
      {summary.done ? null : <span className="loading loading-spinner loading-xs" />}
      {summary.done ? "Synced" : "Syncing"} {summary.relays.length} relays ({summary.negentropy} negentropy) ·{" "}
      {summary.events} events in {ms(summary.elapsed)}
      {summary.failed ? <span className="text-error">· {summary.failed} failed</span> : null}
    </div>
  );
}

/** Shows the root of a thread, loading it with the event loader when it is outside the range */
function RootPreview({ root }: { root: Root }) {
  const event = use$(() => (root.type === "external" ? undefined : eventStore.event(root.pointer)), [root.key]);
  if (root.type === "external") return <span className="truncate">{root.key}</span>;
  if (!event) return <span className="text-base-content/50">Loading thread root…</span>;
  return (
    <span className="truncate">
      <Name pubkey={event.pubkey} />: {event.content.slice(0, 120)}
    </span>
  );
}

function ThreadItem({
  thread,
  selected,
  onSelect,
}: {
  thread: ThreadActivity;
  selected: boolean;
  onSelect: () => void;
}) {
  const latest = thread.replies[0];

  return (
    <button
      className={`flex flex-col gap-1 w-full text-left px-4 py-3 border-b border-base-300 border-l-2 hover:bg-base-200 ${selected ? "bg-base-200 border-l-primary" : "border-l-transparent"}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2 text-sm">
        <div className="flex -space-x-2">
          {thread.participants.slice(0, 4).map((pubkey) => (
            <Avatar key={pubkey} pubkey={pubkey} size="size-6" />
          ))}
        </div>
        <span className="min-w-0 truncate">
          <Name pubkey={latest.pubkey} /> replied
        </span>
        <span className="ms-auto shrink-0 text-base-content/60">{when(latest.created_at)}</span>
      </div>
      <NotePreview event={latest} />
      <div className="flex text-base-content/50 min-w-0">
        <RootPreview root={thread.root} />
      </div>
    </button>
  );
}

function Composer({ parent, onDone }: { parent: NostrEvent; onDone: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await actions.run(() => ReplyTo(parent, text.trim()));
      setText("");
      setBusy(false);
      onDone();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <form className="ml-3 pl-4 border-l border-base-300 py-2 space-y-2" onSubmit={send}>
      <textarea
        className="textarea w-full"
        rows={3}
        autoFocus
        placeholder={parent.kind === kinds.ShortTextNote ? "Write a reply…" : "Write a comment…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        {error ? <span className="text-error text-sm flex-1">{error}</span> : <span className="flex-1" />}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !text.trim()}>
          {busy ? <span className="loading loading-spinner loading-sm" /> : "Reply"}
        </button>
      </div>
    </form>
  );
}

function ThreadEvent({
  event,
  children,
  replyTo,
  onReply,
  depth = 0,
}: {
  event: NostrEvent;
  children: Map<string, NostrEvent[]>;
  replyTo?: string;
  onReply: (id?: string) => void;
  depth?: number;
}) {
  const replies = children.get(getEventKey(event)) ?? [];

  return (
    <div className={depth > 0 ? "border-l border-base-300 pl-4" : ""}>
      <div className="py-3 px-3">
        <div className="flex items-center gap-2 text-sm">
          <Avatar pubkey={event.pubkey} size="size-6" />
          <Name pubkey={event.pubkey} />
          <span className="text-base-content/60">{when(event.created_at)}</span>
          {event.kind === COMMENT_KIND ? <span className="badge badge-ghost">comment</span> : null}
          <button className="btn btn-sm btn-ghost ms-auto" onClick={() => onReply(event.id)}>
            <Reply size={14} /> Reply
          </button>
        </div>
        <div className="mt-2">
          <NoteContent event={event} />
        </div>
      </div>
      {replyTo === event.id ? <Composer parent={event} onDone={() => onReply(undefined)} /> : null}
      {replies.map((reply) => (
        // Cap the indent so deep threads stay readable
        <div key={reply.id} className={depth < 6 ? "ml-3" : ""}>
          <ThreadEvent event={reply} children={children} replyTo={replyTo} onReply={onReply} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function ThreadView({ thread, user }: { thread: ThreadActivity; user: User }) {
  const [replyTo, setReplyTo] = useState<string | undefined>(undefined);

  const summary = use$(() => threadSync$(thread, user), [thread.key, user.pubkey]);
  // Load the root with the event loader too, it may only be on its author's outboxes
  use$(() => (thread.root.type === "external" ? undefined : eventStore.event(thread.root.pointer)), [thread.key]);
  const events = use$(() => eventStore.timeline(threadFilters(thread.root)).pipe(auditTime(100)), [thread.key]);
  const { root, children } = useMemo(() => buildTree(thread.key, events ?? []), [thread.key, events]);
  const props = { children, replyTo, onReply: (id?: string) => setReplyTo(id) };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold flex-1 flex items-center gap-2">
          <MessagesSquare size={18} /> Thread
        </h2>
        <SyncStatus summary={summary} />
      </div>

      {root ? (
        <ThreadEvent event={root} {...props} />
      ) : (
        <div className="space-y-2">
          <div className="p-3 border border-dashed border-base-300 rounded-box text-sm text-base-content/60">
            {thread.root.type === "external" ? thread.key : summary?.done ? "Root not found" : "Loading root…"}
          </div>
          {(children.get(thread.key) ?? []).map((reply) => (
            <ThreadEvent key={reply.id} event={reply} depth={1} {...props} />
          ))}
        </div>
      )}
    </div>
  );
}

function StepRow({ name, detail, summary }: { name: string; detail: string; summary?: SyncSummary }) {
  return (
    <tr>
      <td>
        <div className="font-semibold">{name}</div>
        <div className="text-base-content/60">{detail}</div>
      </td>
      <td>{summary ? summary.done ? "done" : <span className="loading loading-spinner loading-xs" /> : "waiting"}</td>
      <td>
        {summary?.relays.length ?? "–"}
        {summary ? <span className="text-base-content/60"> ({summary.negentropy} neg)</span> : null}
        {summary?.failed ? <span className="text-error"> {summary.failed} failed</span> : null}
      </td>
      <td>{summary?.events ?? "–"}</td>
      <td>{ms(summary?.first)}</td>
      <td>{ms(summary?.elapsed)}</td>
    </tr>
  );
}

const STATE_CLASS: Record<SyncRelayState, string> = {
  pending: "text-base-content/50",
  checking: "text-info",
  loading: "text-info",
  complete: "text-success",
  error: "text-error",
};

function RelayTable({ steps }: { steps: (SyncSummary | undefined)[] }) {
  const relays = [...new Set(steps.flatMap((s) => s?.relays.map((r) => r.relay) ?? []))].sort();
  const cell = (step: SyncSummary | undefined, relay: string) => {
    const row = step?.relays.find((r) => r.relay === relay);
    if (!row) return <td className="text-base-content/30">–</td>;
    const method = [...row.methods].map((m) => (m === "negentropy" ? "neg" : "req")).join("+");
    return (
      <td className={STATE_CLASS[row.state]} title={row.error}>
        {row.count} <span className="text-sm">{method}</span>
      </td>
    );
  };

  return (
    <table className="table table-sm">
      <thead>
        <tr>
          <th>Relay</th>
          <th>Mine</th>
          <th>Inbound</th>
        </tr>
      </thead>
      <tbody>
        {relays.map((relay) => (
          <tr key={relay}>
            <td className="font-mono">{relay}</td>
            {steps.map((step, i) => (
              <Fragment key={i}>{cell(step, relay)}</Fragment>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Metrics({
  mine,
  inbound,
  firstThread,
  threads,
}: {
  mine?: SyncSummary;
  inbound?: SyncSummary;
  firstThread?: number;
  threads: ThreadActivity[];
}) {
  const active = threads.filter((t) => t.replies.length > 0);
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="stats stats-vertical sm:stats-horizontal border border-base-300 w-full">
        <div className="stat">
          <div className="stat-title">First thread</div>
          <div className="stat-value text-2xl">{ms(firstThread)}</div>
        </div>
        <div className="stat">
          <div className="stat-title">Threads</div>
          <div className="stat-value text-2xl">{threads.length}</div>
          <div className="stat-desc">{active.length} with replies</div>
        </div>
        <div className="stat">
          <div className="stat-title">Replies</div>
          <div className="stat-value text-2xl">{active.reduce((n, t) => n + t.replies.length, 0)}</div>
        </div>
      </div>

      <table className="table table-sm">
        <thead>
          <tr>
            <th>Step</th>
            <th>State</th>
            <th>Relays</th>
            <th>Received</th>
            <th>First event</th>
            <th>Elapsed</th>
          </tr>
        </thead>
        <tbody>
          <StepRow name="1. Mine" detail="your notes and comments from your outboxes" summary={mine} />
          <StepRow name="2. Inbound" detail="everything tagging you from your inboxes" summary={inbound} />
        </tbody>
      </table>

      <RelayTable steps={[mine, inbound]} />
    </div>
  );
}

function Dashboard({ user, range }: { user: User; range: Range }) {
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [limit, setLimit] = useState(PAGE_SIZE);

  // Render purely from the event store, shared between the list and the first thread timer
  const activity$ = useMemo(
    () => threads$(user.pubkey, range).pipe(shareReplay({ bufferSize: 1, refCount: true })),
    [user.pubkey, range],
  );
  const threads = use$(activity$);

  const mine = use$(() => mineSync$(user, range), [user.pubkey, range]);
  const inbound = use$(() => inboundSync$(user, range), [user.pubkey, range]);
  use$(() => live$(user), [user.pubkey]);

  const firstThread = use$(
    () =>
      defer(() => {
        const start = Date.now();
        return activity$.pipe(
          first((threads) => threads.some((t) => t.replies.length > 0)),
          map(() => Date.now() - start),
        );
      }),
    [activity$],
  );

  const active = useMemo(
    () =>
      (threads ?? [])
        .filter((t) => t.replies.length > 0)
        .sort((a, b) => b.replies[0].created_at - a.replies[0].created_at),
    [threads],
  );
  const thread = active.find((t) => t.key === selected);

  return (
    <div className="flex min-h-0 grow w-full">
      <section className="w-md shrink-0 border-r border-base-300 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-base-300 space-y-2">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <MessagesSquare size={18} /> Threads
            {threads ? <span className="badge">{active.length}</span> : null}
          </h1>
          <SyncStatus summary={inbound} />
        </div>
        <div className="overflow-y-auto min-h-0 flex-1">
          {!threads ? (
            <div className="p-6 text-center">
              <span className="loading loading-dots" />
            </div>
          ) : active.length === 0 ? (
            <div className="p-6 text-center text-base-content/60">
              {inbound?.done ? "No replies to your threads in this range" : "Looking for replies…"}
            </div>
          ) : (
            active
              .slice(0, limit)
              .map((t) => (
                <ThreadItem key={t.key} thread={t} selected={t.key === selected} onSelect={() => setSelected(t.key)} />
              ))
          )}
          {active.length > limit ? (
            <button className="btn btn-ghost w-full text-primary" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Load more
            </button>
          ) : null}
        </div>
      </section>

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        {thread ? (
          <div>
            <button className="btn btn-ghost btn-sm m-3" onClick={() => setSelected(undefined)}>
              ← Sync metrics
            </button>
            <ThreadView key={thread.key} thread={thread} user={user} />
          </div>
        ) : (
          <Metrics mine={mine} inbound={inbound} firstThread={firstThread} threads={threads ?? []} />
        )}
      </main>
    </div>
  );
}

export default function ThreadsDashboard() {
  const pubkey = use$(pubkey$);
  const signer = use$(signer$);
  const range = use$(range$);

  if (!pubkey || !signer)
    return (
      <LoginView
        onLogin={(s, pk) => {
          signer$.next(s);
          pubkey$.next(pk);
        }}
      />
    );

  return <SignedIn pubkey={pubkey} range={range} />;
}

function SignedIn({ pubkey, range }: { pubkey: string; range: Range }) {
  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300 flex flex-wrap items-center gap-3">
        <Avatar pubkey={pubkey} />
        <div className="flex-1">
          <Name pubkey={pubkey} />
        </div>
        <RangePicker range={range} />
      </div>
      <Dashboard key={pubkey} user={user} range={range} />
    </div>
  );
}
