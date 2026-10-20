/**
 * A GitHub-style inbox of patches and pull requests across all of your NIP-34 repositories, synced with NIP-77
 * @tags nip-34, nip-77, negentropy, git, sync, dashboard, pull-requests
 * @related git/issues-dashboard, git/repository-manager, loader/sync-loader, negentrapy/mentions
 */
import { castEvent, castUser, GitPatch, GitPullRequest, GitRepository, type User } from "applesauce-common/casts";
import {
  COMMENT_KIND,
  getGitGraspServers,
  GIT_GRASP_LIST_KIND,
  GIT_PATCH_KIND,
  GIT_PULL_REQUEST_KIND,
  GIT_PULL_REQUEST_UPDATE_KIND,
  GIT_REPOSITORY_KIND,
  GIT_STATUS_KINDS,
  isGitPatchRoot,
  type GitStatus,
} from "applesauce-common/helpers";
import { defined, EventStore } from "applesauce-core";
import {
  getDisplayName,
  fakeVerifyEvent,
  getProfilePicture,
  markFromCache,
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
  ChevronDown,
  ChevronRight,
  GitMerge,
  GitPullRequest as GitPullRequestIcon,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
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
  distinctUntilChanged,
  EMPTY,
  map,
  merge,
  mergeMap,
  type Observable,
  ignoreElements,
  of,
  share,
  shareReplay,
  switchMap,
  takeLast,
  tap,
  takeUntil,
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
  extraRelays: ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/"],
});

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

const THREAD_KINDS = [GIT_PATCH_KIND, GIT_PULL_REQUEST_KIND];
const ACTIVITY_KINDS = [...GIT_STATUS_KINDS, COMMENT_KIND, GIT_PULL_REQUEST_UPDATE_KIND];
// Keep tag filters small enough for relays that limit filter size
const ID_CHUNK_SIZE = 250;
// How long to collect new root ids before syncing their activity, and how many activity batches to run at once
const ACTIVITY_BATCH_MS = 500;
const ACTIVITY_CONCURRENCY = 2;

const RANGES = [
  { label: "Last week", days: 7 },
  { label: "Last month", days: 30 },
  { label: "Last 3 months", days: 90 },
  { label: "Last year", days: 365 },
  { label: "All time", days: 0 },
];

type Thread = GitPatch | GitPullRequest;
type Row = { thread: Thread; status: GitStatus; updatedAt: number };
type ViewFilter = "inbox" | "authored" | "involved";
type SyncSummary = {
  phase: "repositories" | "threads" | "activity" | "done";
  relays: number;
  negentropy: number;
  request: number;
  failed: number;
  loaded: number;
};
/** The relays and repository addresses to load threads from */
type DashboardContext = { relays: string[]; coords: string[] };
/** The latest status of a single sync load, keyed so several loads can be summarized together */
type KeyedStatus = { key: string; status: SyncLoaderStatus };

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** Merges the status of several sync loads into a single summary */
function summarize(phase: SyncSummary["phase"], statuses: SyncLoaderStatus[]): SyncSummary {
  const relays = new Map<string, { negentropy: boolean; request: boolean; failed: boolean }>();
  let loaded = 0;
  for (const status of statuses) {
    loaded += status.loaded;
    for (const relay of Object.values(status.relays)) {
      const entry = relays.get(relay.relay) ?? { negentropy: false, request: false, failed: false };
      if (relay.method === "negentropy") entry.negentropy = true;
      if (relay.method === "request") entry.request = true;
      if (relay.state === "error") entry.failed = true;
      relays.set(relay.relay, entry);
    }
  }
  const values = [...relays.values()];
  return {
    phase,
    relays: relays.size,
    negentropy: values.filter((r) => r.negentropy).length,
    request: values.filter((r) => r.request && !r.negentropy).length,
    failed: values.filter((r) => r.failed && !r.negentropy && !r.request).length,
    loaded,
  };
}

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

/** Hydrates the filter from the cache, then runs a single sync load and tags its status updates with a key */
function load(key: string, request: SyncLoadRequest): Observable<KeyedStatus> {
  return hydrate(request.filter).pipe(
    concatWith(defer(() => syncLoader(request).status$.pipe(map((status) => ({ key, status }))))),
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
 * Phase 0: syncs the user's repositories and grasp list in a single NIP-77 sync, then emits the context once.
 * Waiting for the sync to finish means the thread sync starts with its final relays and never restarts.
 */
function repositorySync$(user: User): Observable<{ summary: SyncSummary; context?: DashboardContext }> {
  return user.outboxes$.pipe(
    defined(),
    map((outboxes) => relaySet(outboxes)),
    distinctUntilChanged((a, b) => a.join() === b.join()),
    switchMap((outboxes) => {
      const filter = { kinds: [GIT_REPOSITORY_KIND, GIT_GRASP_LIST_KIND], authors: [user.pubkey] };
      const status$ = load("repositories", { relays: outboxes, filter }).pipe(
        map(({ status }) => status),
        share(),
      );
      return merge(
        status$.pipe(map((status) => ({ summary: summarize("repositories", [status]) }))),
        // Read the context from the store once the sync completes
        status$.pipe(
          takeLast(1),
          map((status) => ({
            summary: summarize("repositories", [status]),
            context: readContext(user.pubkey, outboxes),
          })),
        ),
      );
    }),
  );
}

/**
 * Phases 1 and 2: syncs the patches and PRs, and streams their ids into batched syncs of the statuses,
 * comments and PR updates that reference them. Activity starts loading as soon as the first roots arrive.
 */
function threadSync$({ relays, coords }: DashboardContext, pubkey: string, since?: number): Observable<SyncSummary> {
  const range = since ? { since } : {};
  const threadFilters: Filter[] = [{ kinds: THREAD_KINDS, authors: [pubkey], ...range }];
  if (coords.length > 0) threadFilters.push({ kinds: THREAD_KINDS, "#a": coords, ...range });

  return defer(() => {
    // Phase 1: the root events, shared so phase 2 can watch for its completion
    const threads$ = merge(...threadFilters.map((filter, i) => load(`threads:${i}`, { relays, filter }))).pipe(share());

    // Phase 2: every root in range, already stored or newly synced, batched into activity syncs as it arrives
    let batch = 0;
    const activity$ = eventStore.filters(threadFilters).pipe(
      takeUntil(threads$.pipe(takeLast(1))),
      map((event) => event.id),
      bufferTime(ACTIVITY_BATCH_MS),
      mergeMap((ids) => chunk(ids, ID_CHUNK_SIZE)),
      mergeMap((ids) => {
        const n = batch++;
        return merge(
          load(`status:${n}`, { relays, filter: { kinds: GIT_STATUS_KINDS, "#e": ids } }),
          load(`comments:${n}`, { relays, filter: { kinds: [COMMENT_KIND, GIT_PULL_REQUEST_UPDATE_KIND], "#E": ids } }),
        );
      }, ACTIVITY_CONCURRENCY),
    );

    // Summarize the latest status of every load
    const statuses = new Map<string, SyncLoaderStatus>();
    const summary = (phase?: SyncSummary["phase"]) => {
      const threads = [...statuses].filter(([key]) => key.startsWith("threads")).map(([, status]) => status);
      const threadsDone = threads.length === threadFilters.length && threads.every((status) => status.done);
      return summarize(phase ?? (threadsDone ? "activity" : "threads"), [...statuses.values()]);
    };

    return merge(threads$, activity$).pipe(
      map(({ key, status }) => {
        statuses.set(key, status);
        return summary();
      }),
      concatWith(defer(() => of(summary("done")))),
    );
  });
}

/** Subscribes to new threads and activity while the dashboard is open */
function liveUpdates$({ relays, coords }: DashboardContext, pubkey: string) {
  const now = unixNow();
  const filters: Filter[] = [
    { kinds: THREAD_KINDS, authors: [pubkey], since: now },
    { kinds: ACTIVITY_KINDS, "#p": [pubkey], since: now },
  ];
  if (coords.length) filters.push({ kinds: [...THREAD_KINDS, ...ACTIVITY_KINDS], "#a": coords, since: now });
  return pool.subscription(relays, filters, { eventStore });
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** Casts an event to the matching thread class, ignoring invalid events and non-root patches */
function castThread(event: NostrEvent): Thread | undefined {
  try {
    switch (event.kind) {
      case GIT_PULL_REQUEST_KIND:
        return castEvent(event, GitPullRequest, eventStore);
      case GIT_PATCH_KIND:
        return isGitPatchRoot(event) ? castEvent(event, GitPatch, eventStore) : undefined;
    }
  } catch {
    return undefined;
  }
}

/** Builds a reactive list of threads with their current status and last activity, newest activity first */
function threadRows$(filters: Filter[]): Observable<Row[]> {
  return eventStore.timeline(filters).pipe(
    // Rebuild the per-thread subscriptions at most every 100ms while roots stream in
    auditTime(100),
    map((events) => events.map(castThread).filter((t): t is Thread => !!t)),
    switchMap((threads) =>
      threads.length === 0
        ? of([])
        : combineLatest(
            threads.map((thread) =>
              combineLatest([thread.status$, thread.updatedAt$]).pipe(
                map(([status, updatedAt]): Row => ({ thread, status, updatedAt })),
              ),
            ),
          ),
    ),
    // Batch the burst of status and comment updates that arrives while syncing
    auditTime(100),
    map((rows) => [...rows].sort((a, b) => b.updatedAt - a.updatedAt)),
  );
}

const mentions = (thread: Thread, pubkey: string) => thread.event.tags.some((t) => t[0] === "p" && t[1] === pubkey);

type Section = { id: string; title: string; rows: Row[] };

/** Splits the rows into GitHub-like sections for the selected view, the status tabs filter them afterwards */
function buildSections(rows: Row[], filter: ViewFilter, pubkey: string, coords: Set<string>): Section[] {
  const mine = (row: Row) => row.thread.event.pubkey === pubkey;
  const onMyRepo = (row: Row) => coords.has(row.thread.repositoryAddress);

  if (filter === "authored") return [{ id: "authored", title: "Authored by you", rows: rows.filter(mine) }];

  if (filter === "involved") {
    const involved = rows.filter((row) => !mine(row) && mentions(row.thread, pubkey));
    return [{ id: "involved", title: "Involving you", rows: involved }];
  }

  return [
    { id: "repos", title: "On your repositories", rows: rows.filter((r) => onMyRepo(r) && !mine(r)) },
    { id: "mine", title: "Your pull requests", rows: rows.filter(mine) },
  ];
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const timeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function timeAgo(unix: number) {
  const seconds = unix - unixNow();
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return timeFormat.format(Math.round(seconds / size), unit);
  return "just now";
}

const STATUS_LABELS: Record<GitStatus, string> = { open: "Open", draft: "Draft", applied: "Merged", closed: "Closed" };
const STATES: GitStatus[] = ["open", "draft", "applied", "closed"];

function StatusIcon({ status }: { status: GitStatus }) {
  if (status === "applied") return <GitMerge size={16} className="text-secondary" />;
  if (status === "closed") return <GitPullRequestClosed size={16} className="text-error" />;
  if (status === "draft") return <GitPullRequestDraft size={16} className="text-base-content/50" />;
  return <GitPullRequestIcon size={16} className="text-success" />;
}

function RepoName({ thread }: { thread: Thread }) {
  const repo = use$(thread.repository$);
  return <>{repo?.name || thread.repositoryPointer.identifier}</>;
}

function ThreadRow({ row }: { row: Row }) {
  const { thread, status, updatedAt } = row;
  const profile = use$(thread.author.profile$);
  const comments = use$(thread.comments$);

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-base-300 last:border-b-0 hover:bg-base-200">
      <StatusIcon status={status} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{thread.title || "Untitled"}</div>
        <div className="text-sm text-base-content/60 truncate">
          <RepoName thread={thread} />#{thread.id.slice(0, 7)} •{" "}
          {getDisplayName(profile, thread.event.pubkey.slice(0, 8))} • Updated {timeAgo(updatedAt)}
        </div>
      </div>
      {thread instanceof GitPatch ? <span className="badge badge-ghost">patch</span> : null}
      <div className="hidden sm:flex items-center gap-2 w-24 text-sm text-base-content/70">
        <span className={`size-2 rounded-full ${status === "open" ? "bg-warning" : "bg-base-content/40"}`} />
        {STATUS_LABELS[status]}
      </div>
      <div className="flex items-center justify-end gap-1 w-12 text-sm text-base-content/60">
        {comments?.length ? (
          <>
            <MessageSquare size={14} /> {comments.length}
          </>
        ) : (
          "—"
        )}
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

function ThreadSection({ section }: { section: Section }) {
  const [open, setOpen] = useState(true);
  const [limit, setLimit] = useState(PAGE_SIZE);

  return (
    <section className="space-y-2">
      <button className="flex items-center gap-2 font-semibold" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {section.title}
        <span className="badge">{section.rows.length}</span>
      </button>
      {open && section.rows.length > 0 ? (
        <div className="border border-base-300 rounded-box">
          {section.rows.slice(0, limit).map((row) => (
            <ThreadRow key={row.thread.id} row={row} />
          ))}
          {section.rows.length > limit ? (
            <button className="btn btn-ghost w-full text-primary" onClick={() => setLimit(limit + PAGE_SIZE)}>
              Load more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SyncStatus({ summary }: { summary?: SyncSummary }) {
  if (!summary) return null;
  const syncing = summary.phase !== "done";
  return (
    <div className="flex items-center gap-2 text-sm text-base-content/60">
      {syncing ? <span className="loading loading-spinner loading-sm" /> : null}
      <span>
        {syncing ? `Syncing ${summary.phase}` : "Synced"} · {summary.relays} relays · {summary.negentropy} via
        negentropy · {summary.request} via REQ{summary.failed ? ` · ${summary.failed} failed` : ""} · {summary.loaded}{" "}
        events
      </span>
    </div>
  );
}

function RepositoryPicker({
  repos,
  selected,
  onChange,
}: {
  repos: GitRepository[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}) {
  const toggle = (coord: string) => {
    const next = new Set(selected);
    if (next.has(coord)) next.delete(coord);
    else next.add(coord);
    onChange(next);
  };

  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className="btn">
        {selected.size ? `${selected.size} repositories` : "Select repositories"}
      </div>
      <ul tabIndex={0} className="dropdown-content menu bg-base-100 border border-base-300 rounded-box z-10 w-64 p-2">
        {repos.map((repo) => (
          <li key={repo.uid}>
            <label className="flex gap-2">
              <input
                type="checkbox"
                className="checkbox"
                checked={selected.has(repo.coordinate!)}
                onChange={() => toggle(repo.coordinate!)}
              />
              <span className="truncate">{repo.name || repo.identifier}</span>
            </label>
          </li>
        ))}
        {selected.size ? (
          <li>
            <button onClick={() => onChange(new Set())}>Clear selection</button>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

const SIDEBAR: { filter: ViewFilter; label: string }[] = [
  { filter: "inbox", label: "Inbox" },
  { filter: "authored", label: "Authored by me" },
  { filter: "involved", label: "Involves me" },
];

function DashboardView({ user }: { user: User }) {
  const [view, setView] = useState<ViewFilter>("inbox");
  const [state, setState] = useState<GitStatus>("open");
  const [range, setRange] = useState(RANGES[1]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const profile = use$(user.profile$);

  // Phase 0: the user's repositories and grasp list
  const repoSync = use$(() => repositorySync$(user), [user.pubkey]);
  const context = repoSync?.context;
  const contextKey = context ? `${context.relays.join()}|${context.coords.join()}` : "";
  const since = range.days ? unixNow() - range.days * 86400 : undefined;

  // Phases 1 and 2: threads and their activity, re-run only when the context or range changes
  const threadSync = use$(
    () => (context ? threadSync$(context, user.pubkey, since) : undefined),
    [contextKey, user.pubkey, range],
  );

  // Stay up to date with anything new while the dashboard is open
  use$(() => (context ? liveUpdates$(context, user.pubkey) : undefined), [contextKey, user.pubkey]);

  // The repositories come from the store, so the list updates as soon as they sync
  const repos = use$(user.gitRepositories$);
  const coords = useMemo(() => (repos ?? []).map((repo) => repo.coordinate!).sort(), [repos]);

  // Render purely from the event store
  const rows = use$(() => {
    const filters: Filter[] = [{ kinds: THREAD_KINDS, authors: [user.pubkey] }];
    if (coords.length) filters.push({ kinds: THREAD_KINDS, "#a": coords });
    return threadRows$(filters);
  }, [coords.join(), user.pubkey]);

  const sections = useMemo(() => {
    if (!rows) return [];
    const visible = rows.filter(
      (row) =>
        (!since || row.updatedAt >= since) && (selected.size === 0 || selected.has(row.thread.repositoryAddress)),
    );
    return buildSections(visible, view, user.pubkey, new Set(coords));
  }, [rows, since, selected, view, user.pubkey, coords]);

  // The sections never overlap, so their rows can be counted together
  const counts = { open: 0, draft: 0, applied: 0, closed: 0 };
  for (const section of sections) for (const row of section.rows) counts[row.status]++;

  const title = SIDEBAR.find((item) => item.filter === view)!.label;

  return (
    <div className="flex min-h-0 grow w-full">
      <aside className="w-56 shrink-0 border-r border-base-300 p-3 space-y-4 overflow-y-auto">
        <div className="flex items-center gap-2 px-2">
          <img
            src={getProfilePicture(profile, `https://robohash.org/${user.pubkey}`)}
            className="size-6 rounded-full"
          />
          <span className="truncate text-sm">{getDisplayName(profile, user.pubkey.slice(0, 8))}</span>
        </div>
        <ul className="menu w-full p-0">
          <li className="menu-title">Pull requests</li>
          {SIDEBAR.map((item) => (
            <li key={item.filter}>
              <button className={view === item.filter ? "menu-active" : ""} onClick={() => setView(item.filter)}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="min-h-0 flex-1 min-w-0 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold flex-1">{title}</h1>
            <RepositoryPicker repos={repos ?? []} selected={selected} onChange={setSelected} />
            <select
              className="select w-40"
              value={range.label}
              onChange={(e) => setRange(RANGES.find((r) => r.label === e.target.value)!)}
            >
              {RANGES.map((r) => (
                <option key={r.label}>{r.label}</option>
              ))}
            </select>
          </div>

          <SyncStatus summary={threadSync ?? repoSync?.summary} />

          {context && context.coords.length === 0 ? (
            <div className="border border-base-300 rounded-box p-4 text-sm text-base-content/70">
              No repository announcements found. Only threads you authored will be shown.
            </div>
          ) : null}

          {!rows ? <div className="loading loading-dots" /> : null}

          <div className="flex flex-wrap gap-1 border-b border-base-300 pb-2">
            {STATES.map((s) => (
              <button
                key={s}
                className={`btn btn-ghost ${state === s ? "font-semibold" : "text-base-content/60"}`}
                onClick={() => setState(s)}
              >
                <StatusIcon status={s} />
                {STATUS_LABELS[s]}
                <span className="badge">{counts[s]}</span>
              </button>
            ))}
          </div>

          {sections.map((section) => (
            <ThreadSection
              key={`${view}-${state}-${section.id}`}
              section={{ ...section, rows: section.rows.filter((row) => row.status === state) }}
            />
          ))}
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

export default function GitPullRequestDashboard() {
  const pubkey = use$(pubkey$);
  const user = use$(user$);

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="p-3 border-b border-base-300">
        <PubkeyPicker
          value={pubkey}
          onChange={(next) => pubkey$.next(next)}
          placeholder="Pick a user to see their pull requests..."
        />
      </div>
      {user ? (
        <DashboardView key={user.pubkey} user={user} />
      ) : (
        <div className="p-6 space-y-3">
          <p className="text-base-content/60">Pick a user to see the pull requests on their repositories.</p>
          <ClearCache />
        </div>
      )}
    </div>
  );
}
