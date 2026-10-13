/**
 * A full page notifications view that syncs every note and comment that @ mentions a user with NIP-77, then syncs the full thread of a selected mention
 * @tags nip-77, negentropy, nip-10, nip-22, notifications, mentions, sync, threading
 * @related git/issues-dashboard, loader/sync-loader, negentrapy/mentions, threading/note-thread
 */
import "applesauce-content/text/cashu";
import "applesauce-content/text/lightning";
import { castUser, type User } from "applesauce-common/casts";
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
  getContentPointers,
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
  type DecodeResult,
  type Filter,
  type NostrEvent,
} from "applesauce-core/helpers";
import {
  createEventLoaderForStore,
  createSyncLoader,
  type SyncLoaderStatus,
  type SyncLoadRequest,
} from "applesauce-loaders/loaders";
import { type ComponentMap, use$, useRenderedContent } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { AtSign, MessageSquare, MessagesSquare } from "lucide-react";
import { addEvents, getEventsForFilters, openDB } from "nostr-idb";
import { useMemo } from "react";
import {
  auditTime,
  BehaviorSubject,
  catchError,
  concatWith,
  defer,
  distinct,
  EMPTY,
  ignoreElements,
  map,
  merge,
  mergeMap,
  type Observable,
  of,
  scan,
  shareReplay,
  switchMap,
  tap,
} from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";
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

const MENTION_KINDS = [kinds.ShortTextNote, COMMENT_KIND];
// Popular relays synced alongside the user's inboxes, since not every client publishes to the inboxes
const EXTRA_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"];
const PAGE_SIZE = 50;
const DAY = 86400;

/** A unix time range, an open `until` means up to now and keeps a live subscription open */
type Range = { since: number; until?: number; days?: number };
type SyncSummary = {
  relays: number;
  negentropy: number;
  failed: number;
  events: number;
  done: boolean;
  elapsed: number;
};
/** A status update or a newly synced event from a single sync load */
type LoadMessage = { key: string; status: SyncLoaderStatus } | { key: string; event: NostrEvent };

const pubkey$ = new BehaviorSubject("");
const range$ = new BehaviorSubject<Range>({ since: unixNow() - 30 * DAY, days: 30 });
const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));

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

/** Syncs every filter on each relay the moment it is discovered, so new relays add loads instead of restarting them */
function perRelay(relays$: Observable<string[]>, filters: Filter[]): Observable<LoadMessage> {
  return relays$.pipe(
    mergeMap((relays) => relays),
    distinct(),
    mergeMap((relay) => merge(...filters.map((filter, i) => load(`${i}:${relay}`, { relays: [relay], filter })))),
  );
}

/** Reduces the messages of many loads into a single summary of relays, negentropy support and synced events */
function summarize(messages$: Observable<LoadMessage>): Observable<SyncSummary> {
  return defer(() => {
    const start = Date.now();
    return messages$.pipe(
      scan(
        (state, message) => {
          if ("status" in message) state.statuses.set(message.key, message.status);
          else state.events.add(message.event.id);
          return state;
        },
        { statuses: new Map<string, SyncLoaderStatus>(), events: new Set<string>() },
      ),
      auditTime(100),
      map(({ statuses, events }): SyncSummary => {
        const all = [...statuses.values()];
        const relays = new Map<string, boolean>();
        const failed = new Set<string>();
        for (const status of all)
          for (const r of Object.values(status.relays)) {
            relays.set(r.relay, relays.get(r.relay) || r.method === "negentropy");
            if (r.state === "error") failed.add(r.relay);
          }
        return {
          relays: relays.size,
          negentropy: [...relays.values()].filter(Boolean).length,
          failed: failed.size,
          events: events.size,
          done: all.every((status) => status.done),
          elapsed: Date.now() - start,
        };
      }),
    );
  });
}

/** The filter for every note and comment that tags the user within the range */
function mentionsFilter(pubkey: string, { since, until }: Range): Filter {
  const filter: Filter = { kinds: MENTION_KINDS, "#p": [pubkey], since };
  if (until !== undefined) filter.until = until;
  return filter;
}

/** Syncs the mentions from the user's inboxes and the extra relays */
function mentionsSync$(user: User, range: Range): Observable<SyncSummary> {
  const relays$ = merge(of(EXTRA_RELAYS), user.inboxes$.pipe(defined()));
  return summarize(perRelay(relays$, [mentionsFilter(user.pubkey, range)]));
}

/** Subscribes to new mentions while the range is open-ended */
function liveMentions$(user: User) {
  const filter = { kinds: MENTION_KINDS, "#p": [user.pubkey], since: unixNow() };
  return user.inboxes$.pipe(
    defined(),
    switchMap((inboxes) => pool.subscription(relaySet(inboxes, EXTRA_RELAYS), filter, { eventStore })),
  );
}

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

const ContentMentionsSymbol = Symbol("content-mentions");

/** Returns the pubkey of a decoded npub or nprofile */
function getMentionPubkey(pointer: DecodeResult): string | undefined {
  if (pointer.type === "npub") return pointer.data;
  if (pointer.type === "nprofile") return pointer.data.pubkey;
}

/** Returns the pubkeys mentioned with nostr:npub or nostr:nprofile links in the content */
function getContentMentions(event: NostrEvent): Set<string> {
  return getOrComputeCachedValue(event, ContentMentionsSymbol, () => {
    const pubkeys = new Set<string>();
    for (const pointer of getContentPointers(event.content)) {
      const pubkey = getMentionPubkey(pointer);
      if (pubkey) pubkeys.add(pubkey);
    }
    return pubkeys;
  });
}

/** Every event in the store that @ mentions the user in its content, a "p" tag alone isn't a mention */
function mentions$(pubkey: string, range: Range): Observable<NostrEvent[]> {
  return eventStore.timeline(mentionsFilter(pubkey, range)).pipe(
    auditTime(100),
    map((events) => events.filter((e) => e.pubkey !== pubkey && getContentMentions(e).has(pubkey))),
  );
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

/** The root of a thread and the filters that load it and its replies */
type Thread = {
  /** The id, address or external identifier of the root */
  key: string;
  /** The filter for the root event, undefined for external roots */
  root?: Filter;
  /** The filters for every reply in the thread */
  replies: Filter[];
  /** The relay hints from the thread pointers */
  relays: string[];
  /** The authors known from the pointers, the thread is also synced from their outboxes */
  authors: string[];
};

/** Returns a key for a NIP-22 pointer, matching how replies reference their parent */
function getCommentPointerKey(pointer: CommentPointer): string {
  if (pointer.type === "event") return pointer.id;
  if (pointer.type === "address") return createReplaceableAddress(pointer.kind, pointer.pubkey, pointer.identifier);
  return pointer.identifier;
}

/** Finds the root of an event's NIP-10 or NIP-22 thread */
function getThread(event: NostrEvent): Thread {
  const authors = [event.pubkey];

  if (event.kind === COMMENT_KIND) {
    const root = getCommentRootPointer(event);
    if (root?.type === "event") {
      if (root.pubkey) authors.push(root.pubkey);
      return {
        key: root.id,
        root: { ids: [root.id] },
        replies: [{ kinds: [COMMENT_KIND], "#E": [root.id] }],
        relays: relaySet(root.relay),
        authors,
      };
    }
    if (root?.type === "address") {
      const address = getCommentPointerKey(root);
      return {
        key: address,
        root: { kinds: [root.kind], authors: [root.pubkey], "#d": [root.identifier] },
        replies: [{ kinds: [COMMENT_KIND], "#A": [address] }],
        relays: relaySet(root.relay),
        authors: [...authors, root.pubkey],
      };
    }
    if (root?.type === "external") {
      return {
        key: root.identifier,
        replies: [{ kinds: [COMMENT_KIND], "#I": [root.identifier] }],
        relays: [],
        authors,
      };
    }
  }

  // NIP-10 notes, a note without a root is the root of its own thread
  const root = getNip10References(event).root;
  if (root?.e) {
    if (root.e.author) authors.push(root.e.author);
    return {
      key: root.e.id,
      root: { ids: [root.e.id] },
      replies: [
        { kinds: [kinds.ShortTextNote], "#e": [root.e.id] },
        { kinds: [COMMENT_KIND], "#E": [root.e.id] },
      ],
      relays: relaySet(root.e.relays),
      authors,
    };
  }
  if (root?.a) {
    const address = getReplaceableAddressFromPointer(root.a);
    return {
      key: address,
      root: { kinds: [root.a.kind], authors: [root.a.pubkey], "#d": [root.a.identifier] },
      replies: [{ kinds: [kinds.ShortTextNote], "#a": [address] }],
      relays: relaySet(root.a.relays),
      authors: [...authors, root.a.pubkey],
    };
  }

  return {
    key: event.id,
    root: { ids: [event.id] },
    replies: [
      { kinds: [kinds.ShortTextNote], "#e": [event.id] },
      { kinds: [COMMENT_KIND], "#E": [event.id] },
    ],
    relays: [],
    authors,
  };
}

/** Syncs the thread from the hinted relays, the outboxes of its authors and the user's inboxes */
function threadSync$(thread: Thread, event: NostrEvent, user: User): Observable<SyncSummary> {
  // Pointers often omit the root author, so also read the author from the root event once it is found
  const rootAuthor$ = thread.root ? eventStore.filters(thread.root).pipe(map((root) => root.pubkey)) : EMPTY;
  const outboxes$ = merge(of(...thread.authors), rootAuthor$).pipe(
    distinct(),
    mergeMap((pubkey) => castUser(pubkey, eventStore).outboxes$.pipe(defined())),
  );

  const relays$ = merge(
    of(relaySet(thread.relays, [...(getSeenRelays(event) ?? [])], EXTRA_RELAYS)),
    user.inboxes$.pipe(defined()),
    outboxes$,
  );
  const filters = thread.root ? [thread.root, ...thread.replies] : thread.replies;
  return summarize(perRelay(relays$, filters));
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

/** Returns the key replies use to reference an event */
function getEventKey(event: NostrEvent): string {
  return kinds.isAddressableKind(event.kind)
    ? createReplaceableAddress(event.kind, event.pubkey, event.tags.find((t) => t[0] === "d")?.[1])
    : event.id;
}

/** Groups the thread events by parent, attaching replies to missing events to the root so nothing is hidden */
function buildTree(thread: Thread, events: NostrEvent[]) {
  const keys = new Set(events.map(getEventKey));
  const children = new Map<string, NostrEvent[]>();
  let root: NostrEvent | undefined;

  for (const event of [...events].sort((a, b) => a.created_at - b.created_at)) {
    const key = getEventKey(event);
    if (key === thread.key) {
      root = event;
      continue;
    }
    let parent = getParentKey(event) ?? thread.key;
    if (parent !== thread.key && !keys.has(parent)) parent = thread.key;
    children.set(parent, [...(children.get(parent) ?? []), event]);
  }

  return { root, children };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const contentCache = Symbol("mentions-note-content");

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

/** Renders note text with static Nostr content renderers */
function NoteContent({ event, className = "" }: { event: NostrEvent; className?: string }) {
  const content = useRenderedContent(event, components, { cacheKey: contentCache });
  return <div className={`whitespace-pre-wrap break-words ${className}`}>{content}</div>;
}

/** Renders a short preview of the note text, truncated by the content parser */
function NotePreview({ event }: { event: NostrEvent }) {
  const content = useRenderedContent(event, previewComponents, { cacheKey: contentCache, maxLength: 160 });
  return <div className="whitespace-pre-wrap break-words text-sm text-base-content/80">{content}</div>;
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

/** Formats a unix time as a local `YYYY-MM-DD` date input value */
function toDateInput(unix: number) {
  const date = new Date(unix * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Parses a date input value as the start of that local day */
function fromDateInput(value: string) {
  return Math.floor(new Date(`${value}T00:00`).getTime() / 1000);
}

function Avatar({ pubkey, size = "size-8" }: { pubkey: string; size?: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${pubkey}`)}
      className={`${size} rounded-full bg-base-200 shrink-0`}
    />
  );
}

function Name({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return <span className="font-semibold">{getDisplayName(profile, pubkey.slice(0, 8))}</span>;
}

const PRESETS = [1, 7, 30, 90, 365];

function DateRangePicker({ range, onChange }: { range: Range; onChange: (range: Range) => void }) {
  const today = toDateInput(unixNow());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="join">
        {PRESETS.map((days) => (
          <button
            key={days}
            className={`btn btn-sm join-item ${range.days === days ? "btn-active" : ""}`}
            onClick={() => onChange({ since: unixNow() - days * DAY, days })}
          >
            {days === 365 ? "1y" : `${days}d`}
          </button>
        ))}
      </div>
      <input
        type="date"
        className="input input-sm w-36"
        max={today}
        value={toDateInput(range.since)}
        onChange={(e) => e.target.value && onChange({ since: fromDateInput(e.target.value), until: range.until })}
      />
      <span className="text-base-content/60">to</span>
      <input
        type="date"
        className="input input-sm w-36"
        title="Leave empty to include new mentions"
        min={toDateInput(range.since)}
        max={today}
        value={range.until === undefined ? "" : toDateInput(range.until)}
        onChange={(e) =>
          onChange({
            since: range.since,
            // Include the whole selected day, an empty date keeps the range open
            until: e.target.value ? fromDateInput(e.target.value) + DAY - 1 : undefined,
          })
        }
      />
    </div>
  );
}

function SyncStatus({ summary }: { summary?: SyncSummary }) {
  if (!summary) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-base-content/60">
      {summary.done ? null : <span className="loading loading-spinner loading-xs" />}
      {summary.done ? "Synced" : "Syncing"} {summary.relays} relays ({summary.negentropy} negentropy) · {summary.events}{" "}
      events in {(summary.elapsed / 1000).toFixed(1)}s
      {summary.failed ? <span className="text-error">· {summary.failed} failed</span> : null}
    </div>
  );
}

/** Describes where the mention happened */
function mentionType(event: NostrEvent) {
  if (event.kind === COMMENT_KIND) return "a comment";
  return getNip10References(event).root ? "a reply" : "a note";
}

function NotificationItem({
  event,
  selected,
  onSelect,
}: {
  event: NostrEvent;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`flex gap-3 w-full text-left px-4 py-3 border-b border-base-300 border-l-2 hover:bg-base-200 ${selected ? "bg-base-200 border-l-primary" : "border-l-transparent"}`}
      onClick={onSelect}
    >
      <Avatar pubkey={event.pubkey} />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-baseline gap-2 text-sm">
          <span className="min-w-0">
            <Name pubkey={event.pubkey} /> mentioned you in {mentionType(event)}
          </span>
          <span className="ms-auto shrink-0 text-base-content/60">{when(event.created_at)}</span>
        </div>
        <NotePreview event={event} />
      </div>
    </button>
  );
}

function ThreadEvent({
  event,
  children,
  selected,
  depth = 0,
}: {
  event: NostrEvent;
  children: Map<string, NostrEvent[]>;
  selected: string;
  depth?: number;
}) {
  const isSelected = event.id === selected;
  const replies = children.get(getEventKey(event)) ?? [];

  return (
    <div className={depth > 0 ? "border-l border-base-300 pl-4" : ""}>
      <div
        // Bring the mention into view once it has synced
        ref={isSelected ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
        className={`py-3 px-3 rounded-box ${isSelected ? "bg-base-200 ring-1 ring-primary" : ""}`}
      >
        <div className="flex items-center gap-2 text-sm">
          <Avatar pubkey={event.pubkey} size="size-6" />
          <Name pubkey={event.pubkey} />
          <span className="text-base-content/60">{when(event.created_at)}</span>
          {event.kind === COMMENT_KIND ? <span className="badge badge-ghost">comment</span> : null}
        </div>
        <NoteContent event={event} className="mt-2" />
      </div>
      {replies.map((reply) => (
        // Cap the indent so deep threads stay readable
        <div key={reply.id} className={depth < 6 ? "ml-3" : ""}>
          <ThreadEvent event={reply} children={children} selected={selected} depth={depth + 1} />
        </div>
      ))}
    </div>
  );
}

function ThreadView({ event, user }: { event: NostrEvent; user: User }) {
  const thread = useMemo(() => getThread(event), [event]);
  const summary = use$(() => threadSync$(thread, event, user), [thread, user.pubkey]);
  const events = use$(
    () => eventStore.timeline(thread.root ? [thread.root, ...thread.replies] : thread.replies).pipe(auditTime(100)),
    [thread],
  );
  const { root, children } = useMemo(() => buildTree(thread, events ?? []), [thread, events]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold flex-1 flex items-center gap-2">
          <MessagesSquare size={18} /> Thread
        </h2>
        <SyncStatus summary={summary} />
      </div>

      {root ? (
        <ThreadEvent event={root} children={children} selected={event.id} />
      ) : (
        <div className="space-y-2">
          <div className="p-3 border border-dashed border-base-300 rounded-box text-sm text-base-content/60">
            {thread.root ? (summary?.done ? "Root event not found" : "Loading root event...") : thread.key}
          </div>
          {(children.get(thread.key) ?? []).map((reply) => (
            <ThreadEvent key={reply.id} event={reply} children={children} selected={event.id} depth={1} />
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationsView({ user, range }: { user: User; range: Range }) {
  const selected$ = useMemo(() => new BehaviorSubject<string | undefined>(undefined), []);
  const selected = use$(selected$);
  const limit$ = useMemo(() => new BehaviorSubject(PAGE_SIZE), []);
  const limit = use$(limit$);

  // Re-syncing a range that overlaps an earlier one is cheap, negentropy only transfers what the store is missing
  const summary = use$(() => mentionsSync$(user, range), [user.pubkey, range]);
  use$(() => (range.until === undefined ? liveMentions$(user) : undefined), [user.pubkey, range.until]);

  // Render purely from the event store
  const mentions = use$(() => mentions$(user.pubkey, range), [user.pubkey, range]);
  const event = mentions?.find((e) => e.id === selected);

  return (
    <div className="flex min-h-0 grow w-full">
      <section className="w-md shrink-0 border-r border-base-300 flex flex-col min-h-0">
        <div className="px-4 py-3 border-b border-base-300 space-y-1">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <AtSign size={18} /> Mentions
            {mentions ? <span className="badge">{mentions.length}</span> : null}
          </h1>
          <SyncStatus summary={summary} />
        </div>
        <div className="overflow-y-auto min-h-0 flex-1">
          {!mentions ? (
            <div className="p-6 text-center">
              <span className="loading loading-dots" />
            </div>
          ) : mentions.length === 0 ? (
            <div className="p-6 text-center text-base-content/60">
              {summary?.done ? "No mentions in this range" : "Looking for mentions..."}
            </div>
          ) : (
            mentions
              .slice(0, limit)
              .map((mention) => (
                <NotificationItem
                  key={mention.id}
                  event={mention}
                  selected={mention.id === selected}
                  onSelect={() => selected$.next(mention.id)}
                />
              ))
          )}
          {mentions && mentions.length > limit ? (
            <button className="btn btn-ghost w-full text-primary" onClick={() => limit$.next(limit + PAGE_SIZE)}>
              Load more
            </button>
          ) : null}
        </div>
      </section>

      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        {event ? (
          <ThreadView key={event.id} event={event} user={user} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-base-content/60">
            <MessageSquare size={32} />
            Select a mention to load its thread
          </div>
        )}
      </main>
    </div>
  );
}

export default function MentionsNotifications() {
  const pubkey = use$(pubkey$);
  const user = use$(user$);
  const range = use$(range$);

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300 flex flex-wrap items-center gap-3">
        <PubkeyPicker
          className="flex-1 min-w-64"
          value={pubkey}
          onChange={(next) => pubkey$.next(next)}
          placeholder="Pick a user to see their mentions..."
        />
        <DateRangePicker range={range} onChange={(next) => range$.next(next)} />
      </div>
      {user ? (
        <NotificationsView key={user.pubkey} user={user} range={range} />
      ) : (
        <div className="p-6 text-base-content/60">Pick a user to sync every note and comment that mentions them.</div>
      )}
    </div>
  );
}
