/**
 * A GitHub-style issues dashboard across your NIP-34 repositories with a query bar, synced as fast as possible with NIP-77
 * @tags nip-34, nip-77, negentropy, git, sync, dashboard, issues
 * @related git/pull-request-dashboard, git/repo-issues, loader/sync-loader
 */
import { castEvent, castUser, GitIssue, GitRepository, type User } from "applesauce-common/casts";
import {
  COMMENT_KIND,
  getGitGraspServers,
  GIT_GRASP_LIST_KIND,
  GIT_ISSUE_KIND,
  GIT_REPOSITORY_KIND,
  GIT_STATUS_KINDS,
  type GitStatus,
} from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore } from "applesauce-core";
import {
  getDisplayName,
  fakeVerifyEvent,
  getProfilePicture,
  markFromCache,
  normalizeToPubkey,
  relaySet,
  unixNow,
  type Filter,
  persistEventsToCache,
  type NostrEvent,
} from "applesauce-core/helpers";
import { addEvents, clearDB, countEvents, getEventsForFilters, openDB } from "nostr-idb";
import {
  createEventLoaderForStore,
  createSyncLoader,
  type SyncLoaderStatus,
  type SyncLoadRequest,
} from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import {
  ArrowDownWideNarrow,
  AtSign,
  CircleCheck,
  CircleDot,
  CircleSlash,
  Clock,
  FolderGit2,
  List,
  MessageSquare,
  Plus,
  Rows3,
  Search,
  SquarePen,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  auditTime,
  BehaviorSubject,
  bufferTime,
  catchError,
  combineLatest,
  concatWith,
  defer,
  distinct,
  distinctUntilChanged,
  EMPTY,
  filter,
  map,
  merge,
  mergeMap,
  type Observable,
  ignoreElements,
  of,
  ReplaySubject,
  scan,
  share,
  shareReplay,
  switchMap,
  takeLast,
  tap,
} from "rxjs";
import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

// The user whose dashboard is shown, any pubkey works since the dashboard only reads public events
const pubkey$ = new BehaviorSubject("");

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

const user$ = pubkey$.pipe(map((pubkey) => (pubkey ? castUser(pubkey, eventStore) : undefined)));

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
  extraRelays: ["wss://relay.ngit.dev/", "wss://relay.damus.io/", "wss://nos.lol/"],
});

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

const ACTIVITY_KINDS = [...GIT_STATUS_KINDS, COMMENT_KIND];
// Keep tag filters small enough for relays that limit filter size
const ID_CHUNK_SIZE = 250;
const PAGE_SIZE = 25;

type Row = { issue: GitIssue; status: GitStatus; updatedAt: number; comments: number };
type IssueState = "open" | "resolved" | "closed";
type Sort = "updated-desc" | "updated-asc" | "created-desc" | "created-asc" | "comments-desc";
type SyncSummary = { relays: number; negentropy: number; events: number; done: boolean; elapsed: number };
/** The relays and repository addresses of the user's repositories */
type DashboardContext = { relays: string[]; coords: string[] };
/** A status update or a newly synced event from a single sync load */
type LoadMessage = { key: string; status: SyncLoaderStatus } | { key: string; event: NostrEvent };

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
      // A failed cache read falls back to syncing everything from the relays
      catchError(() => EMPTY),
      // Replay the completion so every load of the same filter waits on a single cache read
      shareReplay(1),
    );
    hydrated.set(key, hydrate$);
  }
  return hydrate$;
}

// Re-counts the cached events whenever the cache changes
const cacheChanged$ = new BehaviorSubject<void>(undefined);
const cachedEvents$ = cacheChanged$.pipe(switchMap(() => countEvents(cache)));

/** Empties the IndexedDB cache and the in-memory store so the next sync starts from nothing */
async function clearCache() {
  await clearDB(cache);
  hydrated.clear();
  for (const event of eventStore.getByFilters({})) eventStore.remove(event);
  cacheChanged$.next();
}

/** Hydrates the filter from the cache, then runs a single sync load and tags its status updates and new events with a key */
function load(key: string, request: SyncLoadRequest): Observable<LoadMessage> {
  return hydrate(request.filter).pipe(
    concatWith(
      defer(() => {
        // status$ and events$ share a single run, so subscribing to both doesn't load twice
        const { status$, events$ } = syncLoader(request);
        return merge(status$.pipe(map((status) => ({ key, status }))), events$.pipe(map((event) => ({ key, event }))));
      }),
    ),
  );
}

/** Starts a sync on each relay the moment it is discovered, so new relays add loads instead of restarting them */
function perRelay(key: string, relays$: Observable<string[]>, filter: Filter): Observable<LoadMessage> {
  return relays$.pipe(
    mergeMap((relays) => relays),
    distinct(),
    mergeMap((relay) => load(`${key}:${relay}`, { relays: [relay], filter })),
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Reads the user's repositories and grasp servers from the store */
function readContext(pubkey: string, outboxes: string[]): DashboardContext {
  const repos = eventStore
    .getByFilters({ kinds: [GIT_REPOSITORY_KIND], authors: [pubkey] })
    .map((event) => castEvent(event, GitRepository, eventStore));
  const grasp = getGitGraspServers(eventStore.getReplaceable(GIT_GRASP_LIST_KIND, pubkey));

  return {
    relays: relaySet(outboxes, grasp, ...repos.map((repo) => repo.relays)),
    coords: repos.map((repo) => repo.coordinate!).sort(),
  };
}

/**
 * Syncs every issue that involves the user, and their statuses and comments. Nothing waits on anything it doesn't
 * need: authored issues start on the outboxes and mentions on the inboxes while the repositories are still syncing.
 */
function issuesSync$(user: User): Observable<SyncSummary> {
  const pubkey = user.pubkey;

  return defer(() => {
    const start = Date.now();
    const outboxes$ = user.outboxes$.pipe(
      defined(),
      map((relays) => relaySet(relays)),
    );
    const inboxes$ = user.inboxes$.pipe(
      defined(),
      map((relays) => relaySet(relays)),
    );

    // The repositories and grasp list in a single sync, then the context is read once it completes
    const repos$ = outboxes$.pipe(
      distinctUntilChanged((a, b) => a.join() === b.join()),
      switchMap((relays) => {
        const status$ = load("repos", {
          relays,
          filter: { kinds: [GIT_REPOSITORY_KIND, GIT_GRASP_LIST_KIND], authors: [pubkey] },
        }).pipe(share());
        return merge(
          status$,
          status$.pipe(
            takeLast(1),
            map(() => ({ context: readContext(pubkey, relays) })),
          ),
        );
      }),
      share(),
    );
    const context$ = repos$.pipe(
      filter((m): m is { context: DashboardContext } => "context" in m),
      map((m) => m.context),
      share({ connector: () => new ReplaySubject(1) }),
    );
    const contextRelays$ = context$.pipe(map((context) => context.relays));

    // Issues on the user's repositories, and the statuses that tag the repository (most clients add the "a" tag)
    const onRepos$ = context$.pipe(
      switchMap(({ relays, coords }) =>
        coords.length === 0
          ? EMPTY
          : merge(
              perRelay("repo-issues", of(relays), { kinds: [GIT_ISSUE_KIND], "#a": coords }),
              perRelay("repo-status", of(relays), { kinds: GIT_STATUS_KINDS, "#a": coords }),
            ),
      ),
    );

    // Every relay we read from, replayed so the activity sync sees all of them
    const relays$ = merge(outboxes$, inboxes$, contextRelays$).pipe(
      mergeMap((relays) => relays),
      distinct(),
      share({ connector: () => new ReplaySubject() }),
    );

    // By id: statuses without an "a" tag and comments. Each (relay, issue) pair is synced exactly once
    const known = { relays: [] as string[], ids: [] as string[] };
    let n = 0;
    const activity$ = merge(
      relays$.pipe(map((relay) => ({ relays: [relay], ids: known.ids, relay }))),
      eventStore.filters({ kinds: [GIT_ISSUE_KIND] }).pipe(
        map((event) => event.id),
        bufferTime(300),
        filter((ids) => ids.length > 0),
        map((ids) => ({ relays: known.relays, ids, relay: undefined })),
      ),
    ).pipe(
      mergeMap(({ relays, ids, relay }) => {
        // Snapshot before updating so new relays get old ids and new ids go to old relays
        const work = chunk([...ids], ID_CHUNK_SIZE).map((ids) => ({ relays: [...relays], ids }));
        if (relay) known.relays.push(relay);
        else known.ids.push(...ids);
        return work.filter((w) => w.relays.length > 0);
      }),
      mergeMap(({ relays, ids }) => {
        const key = `activity:${n++}`;
        return merge(
          load(`${key}:status`, { relays, filter: { kinds: GIT_STATUS_KINDS, "#e": ids } }),
          load(`${key}:comments`, { relays, filter: { kinds: [COMMENT_KIND], "#E": ids } }),
        );
      }, 4),
    );

    return merge(
      repos$.pipe(filter((m): m is LoadMessage => !("context" in m))),
      perRelay("authored", outboxes$, { kinds: [GIT_ISSUE_KIND], authors: [pubkey] }),
      perRelay("mentions", inboxes$, { kinds: [GIT_ISSUE_KIND], "#p": [pubkey] }),
      onRepos$,
      activity$,
    ).pipe(
      // Track the latest status of each load and the unique events synced across all loads
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
        for (const status of all)
          for (const r of Object.values(status.relays))
            relays.set(r.relay, relays.get(r.relay) || r.method === "negentropy");
        return {
          relays: relays.size,
          negentropy: [...relays.values()].filter(Boolean).length,
          events: events.size,
          done: all.every((status) => status.done),
          elapsed: Date.now() - start,
        };
      }),
    );
  });
}

/** Subscribes to new issues and activity while the dashboard is open */
function liveUpdates$(user: User) {
  const now = unixNow();
  return combineLatest([user.outboxes$.pipe(defined()), user.inboxes$.pipe(defined()), user.gitRepositories$]).pipe(
    switchMap(([outboxes, inboxes, repos]) => {
      const coords = (repos ?? []).map((repo) => repo.coordinate!);
      const filters: Filter[] = [
        { kinds: [GIT_ISSUE_KIND], authors: [user.pubkey], since: now },
        { kinds: [GIT_ISSUE_KIND, ...ACTIVITY_KINDS], "#p": [user.pubkey], since: now },
      ];
      if (coords.length) filters.push({ kinds: [GIT_ISSUE_KIND, ...ACTIVITY_KINDS], "#a": coords, since: now });
      const relays = relaySet(outboxes, inboxes, ...(repos ?? []).map((repo) => repo.relays));
      return pool.subscription(relays, filters, { eventStore });
    }),
  );
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** A parsed GitHub-style search query like `is:issue state:open author:@me sort:updated-desc` */
type Query = {
  state: IssueState;
  author?: string;
  mentions?: string;
  repo?: string;
  labels: string[];
  sort: Sort;
  text: string;
};

const STATES: { state: IssueState; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "resolved", label: "Resolved" },
  { state: "closed", label: "Closed" },
];

const SORTS: { value: Sort; label: string }[] = [
  { value: "updated-desc", label: "Recently updated" },
  { value: "updated-asc", label: "Least recently updated" },
  { value: "created-desc", label: "Newest" },
  { value: "created-asc", label: "Oldest" },
  { value: "comments-desc", label: "Most commented" },
];

/** Parses the query string, resolving `@me` to the user's pubkey */
function parseQuery(input: string, pubkey: string): Query {
  const query: Query = { state: "open", labels: [], sort: "updated-desc", text: "" };
  const words: string[] = [];
  const person = (value: string) => (value === "@me" ? pubkey : (normalizeToPubkey(value) ?? value));

  for (const token of input.trim().split(/\s+/).filter(Boolean)) {
    const [key, value] = token.split(/:(.*)/s);
    if (value === undefined) words.push(token);
    else if (key === "state") query.state = STATES.find((s) => s.state === value)?.state ?? "open";
    else if (key === "author") query.author = person(value);
    else if (key === "mentions") query.mentions = person(value);
    else if (key === "repo") query.repo = value;
    else if (key === "label") query.labels.push(value);
    else if (key === "sort" && SORTS.some((s) => s.value === value)) query.sort = value as Sort;
    else if (key !== "is") words.push(token);
  }

  query.text = words.join(" ").toLowerCase();
  return query;
}

/** Replaces a qualifier in the query string, or appends it */
function setQualifier(input: string, key: string, value: string) {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  const index = tokens.findIndex((t) => t.startsWith(`${key}:`));
  if (index === -1) tokens.push(`${key}:${value}`);
  else tokens[index] = `${key}:${value}`;
  return tokens.join(" ");
}

/** Checks a row against every part of the query except the state */
function matches({ issue }: Row, query: Query, coords: Set<string>) {
  if (query.author && issue.event.pubkey !== query.author) return false;
  if (query.mentions && !issue.event.tags.some((t) => t[0] === "p" && t[1] === query.mentions)) return false;
  if (query.repo === "@me" && !coords.has(issue.repositoryAddress)) return false;
  if (query.repo && query.repo !== "@me" && issue.repositoryPointer.identifier !== query.repo) return false;
  if (query.labels.some((label) => !issue.labels.includes(label))) return false;
  if (query.text && !issue.title.toLowerCase().includes(query.text)) return false;
  return true;
}

function sortRows(rows: Row[], sort: Sort) {
  const [field, direction] = sort.split("-");
  const key = (row: Row) =>
    field === "updated" ? row.updatedAt : field === "comments" ? row.comments : row.issue.event.created_at;
  return [...rows].sort((a, b) => (direction === "asc" ? key(a) - key(b) : key(b) - key(a)));
}

/** Groups the NIP-34 statuses into the open, resolved and closed tabs */
function stateOf({ status }: Row): IssueState {
  if (status === "applied") return "resolved";
  if (status === "closed") return "closed";
  return "open";
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** Every issue in the store with its status, last activity and comment count */
function issueRows$(): Observable<Row[]> {
  return eventStore.timeline({ kinds: [GIT_ISSUE_KIND] }).pipe(
    // Rebuild the per-issue subscriptions at most every 100ms while issues stream in
    auditTime(100),
    castTimelineStream(GitIssue, eventStore),
    switchMap((issues) =>
      issues.length === 0
        ? of([])
        : combineLatest(
            issues.map((issue) =>
              combineLatest([issue.status$, issue.updatedAt$, issue.comments$]).pipe(
                map(([status, updatedAt, comments]): Row => ({ issue, status, updatedAt, comments: comments.length })),
              ),
            ),
          ),
    ),
    // Batch the burst of status and comment updates that arrives while syncing
    auditTime(100),
  );
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const dateFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const yearFormat = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
const timeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });

/** Formats a timestamp like GitHub: relative within a month, then "on May 22", with the year once it's not this year */
function when(unix: number) {
  const seconds = unix - unixNow();
  if (Math.abs(seconds) > 30 * 86400) {
    const date = new Date(unix * 1000);
    return `on ${(date.getFullYear() === new Date().getFullYear() ? dateFormat : yearFormat).format(date)}`;
  }
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return timeFormat.format(Math.round(seconds / size), unit);
  return "just now";
}

function StatusIcon({ status }: { status: GitStatus }) {
  if (status === "applied") return <CircleCheck size={16} className="text-secondary shrink-0" />;
  if (status === "closed") return <CircleSlash size={16} className="text-base-content/50 shrink-0" />;
  return <CircleDot size={16} className="text-success shrink-0" />;
}

/** The `owner/repo` name of the issue's repository */
function RepoName({ issue }: { issue: GitIssue }) {
  const repo = use$(issue.repository$);
  const owner = use$(
    () => castUser(issue.repositoryPointer.pubkey, eventStore).profile$,
    [issue.repositoryPointer.pubkey],
  );
  return (
    <>
      {getDisplayName(owner, issue.repositoryPointer.pubkey.slice(0, 8))}/
      {repo?.name || issue.repositoryPointer.identifier}
    </>
  );
}

function Avatar({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return (
    <img
      src={getProfilePicture(profile, `https://robohash.org/${pubkey}`)}
      title={getDisplayName(profile, pubkey.slice(0, 8))}
      className="size-6 rounded-full border-2 border-base-100 bg-base-200"
    />
  );
}

/** Stacked avatars of the author and the first commenters */
function Participants({ issue }: { issue: GitIssue }) {
  const comments = use$(issue.comments$);
  const pubkeys = [...new Set([issue.event.pubkey, ...(comments ?? []).map((c) => c.event.pubkey)])].slice(0, 3);
  return (
    <div className="flex -space-x-2 w-16 justify-end">
      {pubkeys.map((pubkey) => (
        <Avatar key={pubkey} pubkey={pubkey} />
      ))}
    </div>
  );
}

function IssueRow({ row, compact, onLabel }: { row: Row; compact: boolean; onLabel: (label: string) => void }) {
  const { issue, status, updatedAt, comments } = row;
  const author = use$(issue.author.profile$);

  return (
    <div
      className={`flex items-start gap-3 px-4 border-b border-base-300 last:border-b-0 hover:bg-base-200 ${compact ? "py-1.5" : "py-2.5"}`}
    >
      <div className="pt-1">
        <StatusIcon status={status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{issue.title || "Untitled"}</span>
          {issue.labels.map((label) => (
            <button key={label} className="badge badge-outline" onClick={() => onLabel(label)}>
              {label}
            </button>
          ))}
        </div>
        {compact ? null : (
          <div className="text-sm text-base-content/60 truncate">
            <RepoName issue={issue} />#{issue.id.slice(0, 7)} · {getDisplayName(author, issue.event.pubkey.slice(0, 8))}{" "}
            opened {when(issue.event.created_at)} · Updated {when(updatedAt)}
          </div>
        )}
      </div>
      <span className="flex items-center gap-1 w-12 pt-1 text-sm text-base-content/60">
        {comments ? (
          <>
            <MessageSquare size={14} /> {comments}
          </>
        ) : null}
      </span>
      <Participants issue={issue} />
    </div>
  );
}

function SyncStatus({ summary }: { summary?: SyncSummary }) {
  if (!summary) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-base-content/60">
      {summary.done ? null : <span className="loading loading-spinner loading-sm" />}
      {summary.done ? "Synced" : "Syncing"} {summary.relays} relays ({summary.negentropy} with negentropy) ·{" "}
      {summary.events} events in {(summary.elapsed / 1000).toFixed(1)}s
    </div>
  );
}

const DEFAULT_QUERY = "is:issue state:open repo:@me sort:updated-desc";

const SIDEBAR = [
  { label: "On my repositories", icon: FolderGit2, query: DEFAULT_QUERY },
  { label: "Created by me", icon: SquarePen, query: "is:issue state:open author:@me sort:updated-desc" },
  { label: "Mentioning me", icon: AtSign, query: "is:issue state:open mentions:@me sort:updated-desc" },
  { label: "Recently updated", icon: Clock, query: "is:issue state:open sort:updated-desc" },
];

// Saved views live for the whole session, like GitHub's custom views
const views$ = new BehaviorSubject<string[]>(["is:issue state:open label:bug sort:updated-desc"]);

function DashboardView({ user }: { user: User }) {
  const [input, setInputValue] = useState(DEFAULT_QUERY);
  const [compact, setCompact] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const views = use$(views$);

  const summary = use$(() => issuesSync$(user), [user.pubkey]);
  use$(() => liveUpdates$(user), [user.pubkey]);

  // Render purely from the event store
  const rows = use$(issueRows$, []);
  const repos = use$(user.gitRepositories$);
  const coords = useMemo(() => new Set((repos ?? []).map((repo) => repo.coordinate!)), [repos]);

  const query = useMemo(() => parseQuery(input, user.pubkey), [input, user.pubkey]);
  const filtered = useMemo(() => (rows ?? []).filter((row) => matches(row, query, coords)), [rows, query, coords]);
  const counts = { open: 0, resolved: 0, closed: 0 };
  for (const row of filtered) counts[stateOf(row)]++;
  const visible = sortRows(
    filtered.filter((row) => stateOf(row) === query.state),
    query.sort,
  );

  const setInput = (value: string) => {
    setInputValue(value);
    setLimit(PAGE_SIZE);
  };
  const title = SIDEBAR.find((item) => item.query === input)?.label ?? (views?.includes(input) ? input : "Issues");

  return (
    <div className="flex min-h-0 grow w-full">
      <aside className="w-60 shrink-0 border-r border-base-300 p-3 space-y-4 overflow-y-auto">
        <ul className="menu w-full p-0">
          {SIDEBAR.map((item) => (
            <li key={item.label}>
              <button className={input === item.query ? "menu-active" : ""} onClick={() => setInput(item.query)}>
                <item.icon size={16} /> {item.label}
              </button>
            </li>
          ))}
        </ul>
        <ul className="menu w-full p-0">
          <li className="menu-title flex-row items-center justify-between">
            Views
            <button
              className="btn btn-ghost btn-square btn-sm"
              title="Save current query"
              onClick={() => views$.next([...new Set([...views$.value, input])])}
            >
              <Plus size={16} />
            </button>
          </li>
          {views?.map((view) => (
            <li key={view}>
              <div className={`flex ${input === view ? "menu-active" : ""}`} onClick={() => setInput(view)}>
                <Search size={16} className="shrink-0" />
                <span className="flex-1 truncate">{view.replace(/is:issue\s*/, "")}</span>
                <button
                  title="Remove view"
                  onClick={(e) => {
                    e.stopPropagation();
                    views$.next(views$.value.filter((v) => v !== view));
                  }}
                >
                  <X size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <main className="min-h-0 flex-1 min-w-0 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold flex-1 truncate">{title}</h1>
            <SyncStatus summary={summary} />
          </div>

          <label className="input w-full">
            <Search size={16} className="opacity-60" />
            <input className="grow font-mono" value={input} onChange={(e) => setInput(e.target.value)} />
            {input ? (
              <button className="btn btn-ghost btn-square btn-sm" title="Clear" onClick={() => setInput("")}>
                <X size={16} />
              </button>
            ) : null}
          </label>

          <div className="border border-base-300 rounded-box">
            <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-base-300 bg-base-200">
              {STATES.map(({ state, label }) => (
                <button
                  key={state}
                  className={`btn btn-ghost ${query.state === state ? "font-semibold" : "text-base-content/60"}`}
                  onClick={() => setInput(setQualifier(input, "state", state))}
                >
                  <StatusIcon status={state === "resolved" ? "applied" : state} />
                  {label}
                  <span className="badge">{counts[state]}</span>
                </button>
              ))}
              <div className="flex-1" />
              <label className="select select-ghost w-56">
                <ArrowDownWideNarrow size={16} className="opacity-60" />
                <select value={query.sort} onChange={(e) => setInput(setQualifier(input, "sort", e.target.value))}>
                  {SORTS.map((sort) => (
                    <option key={sort.value} value={sort.value}>
                      {sort.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="join">
                <button
                  className={`btn btn-square join-item ${compact ? "" : "btn-active"}`}
                  title="Comfortable"
                  onClick={() => setCompact(false)}
                >
                  <Rows3 size={16} />
                </button>
                <button
                  className={`btn btn-square join-item ${compact ? "btn-active" : ""}`}
                  title="Compact"
                  onClick={() => setCompact(true)}
                >
                  <List size={16} />
                </button>
              </div>
            </div>

            {!rows ? (
              <div className="p-6 text-center">
                <span className="loading loading-dots" />
              </div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-center text-base-content/60">
                {summary?.done ? "No results matched your search" : "Looking for issues..."}
              </div>
            ) : (
              visible
                .slice(0, limit)
                .map((row) => (
                  <IssueRow
                    key={row.issue.id}
                    row={row}
                    compact={!!compact}
                    onLabel={(label) => setInput(`${input} label:${label}`)}
                  />
                ))
            )}
            {visible.length > limit ? (
              <button className="btn btn-ghost w-full text-primary" onClick={() => setLimit(limit + PAGE_SIZE)}>
                Load more
              </button>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Clears the cache before picking a user, for testing a fresh sync */
function ClearCache() {
  const count = use$(cachedEvents$);
  return (
    <div className="flex items-center gap-3 text-sm text-base-content/60">
      {count === undefined ? "Counting cached events..." : `${count} events cached`}
      <button className="btn btn-sm" disabled={!count} onClick={clearCache}>
        Clear cache
      </button>
    </div>
  );
}

export default function GitIssuesDashboard() {
  const pubkey = use$(pubkey$);
  const user = use$(user$);

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300">
        <PubkeyPicker
          value={pubkey}
          onChange={(next) => pubkey$.next(next)}
          placeholder="Pick a user to see their issues..."
        />
      </div>
      {user ? (
        <DashboardView key={user.pubkey} user={user} />
      ) : (
        <div className="p-6 space-y-3">
          <p className="text-base-content/60">Pick a user to see the issues on their repositories.</p>
          <ClearCache />
        </div>
      )}
    </div>
  );
}
