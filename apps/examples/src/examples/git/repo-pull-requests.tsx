/**
 * A GitHub-style pull requests page for a single NIP-34 repository, loaded with incremental per-relay NIP-77 sync
 * @tags nip-34, nip-77, negentropy, git, sync, pull-requests, patches
 * @related git/repo-issues, git/pull-request-dashboard, loader/sync-loader
 */
import { castUser, GitPatch, GitPullRequest, GitRepository, type User } from "applesauce-common/casts";
import {
  COMMENT_KIND,
  getGitRepositoryRelays,
  GIT_PATCH_KIND,
  GIT_PULL_REQUEST_KIND,
  GIT_PULL_REQUEST_UPDATE_KIND,
  GIT_REPOSITORY_KIND,
  GIT_STATUS_KINDS,
  isGitPatchRoot,
  type GitRepositoryPointer,
  type GitStatus,
} from "applesauce-common/helpers";
import { GitRepositoryPatchesModel, GitRepositoryPullRequestsModel } from "applesauce-common/models";
import { castEventStream, castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore } from "applesauce-core";
import {
  fakeVerifyEvent,
  type Filter,
  getDisplayName,
  getProfilePicture,
  getReplaceableAddressFromPointer,
  markFromCache,
  naddrEncode,
  normalizeToAddressPointer,
  type NostrEvent,
  persistEventsToCache,
  relaySet,
  unixNow,
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
import type { ISigner } from "applesauce-signers";
import {
  ChevronDown,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest as GitPullRequestIcon,
  GitPullRequestClosed,
  GitPullRequestDraft,
  MessageSquare,
} from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";
import {
  auditTime,
  BehaviorSubject,
  bufferTime,
  catchError,
  combineLatest,
  concatWith,
  defer,
  distinct,
  EMPTY,
  filter,
  from,
  ignoreElements,
  map,
  merge,
  mergeMap,
  type Observable,
  of,
  ReplaySubject,
  scan,
  share,
  shareReplay,
  switchMap,
  tap,
} from "rxjs";
import LoginView from "../../components/login-view";
import { lookupRelays$ } from "../../settings";

const signer$ = new BehaviorSubject<ISigner | null>(null);
const pubkey$ = new BehaviorSubject<string | null>(null);
const repo$ = new BehaviorSubject<GitRepositoryPointer | null>(null);

const eventStore = new EventStore();
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

// Keep tag filters small enough for relays that limit filter size
const ID_CHUNK_SIZE = 250;
const PAGE_SIZE = 25;

type Thread = GitPullRequest | GitPatch;
type Row = { pr: Thread; status: GitStatus; updatedAt: number };
type SyncSummary = {
  relays: number;
  negentropy: number;
  events: number;
  loads: number;
  done: boolean;
  elapsed: number;
};
/** A status update or a newly synced event from a single sync load */
type LoadMessage = { key: string; status: SyncLoaderStatus } | { key: string; event: NostrEvent };
type Query = {
  view: "all" | "created" | "mentioned" | "recent";
  state: GitStatus;
  author: string | null;
  label: string | null;
  sort: "newest" | "oldest" | "updated";
  search: string;
};

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/** Streams each relay to read the repository from: the naddr hints first, then the announcement's relays */
function repositoryRelays$(pointer: GitRepositoryPointer): Observable<string> {
  return merge(
    from(relaySet(pointer.relays)),
    // The event loader fetches the announcement from the hints and lookup relays
    eventStore.replaceable(pointer).pipe(
      defined(),
      mergeMap((repo) => getGitRepositoryRelays(repo)),
    ),
  ).pipe(distinct());
}

/**
 * Syncs every pull request, patch, status, update and comment of a repository. Each relay starts syncing the moment
 * it is discovered, so a late-loading announcement adds relays instead of restarting the sync.
 */
function pullRequestsSync$(pointer: GitRepositoryPointer): Observable<SyncSummary> {
  const coord = getReplaceableAddressFromPointer(pointer);
  const rootsFilter: Filter = { kinds: [GIT_PULL_REQUEST_KIND, GIT_PATCH_KIND], "#a": [coord] };

  return defer(() => {
    const start = Date.now();
    // Replay every relay so both pipelines below see all of them
    const relays$ = repositoryRelays$(pointer).pipe(share({ connector: () => new ReplaySubject() }));

    // Per relay: the PRs and patches, plus the statuses and PR updates that tag the repository
    const direct$ = relays$.pipe(
      mergeMap((relay) =>
        merge(
          load(`roots:${relay}`, { relays: [relay], filter: rootsFilter }),
          load(`tagged:${relay}`, {
            relays: [relay],
            filter: { kinds: [...GIT_STATUS_KINDS, GIT_PULL_REQUEST_UPDATE_KIND], "#a": [coord] },
          }),
        ),
      ),
    );

    // By id: statuses without an "a" tag, comments and updates. Each (relay, root) pair is synced exactly once
    const known = { relays: [] as string[], ids: [] as string[] };
    let n = 0;
    const activity$ = merge(
      relays$.pipe(map((relay) => ({ relays: [relay], ids: known.ids, relay }))),
      eventStore.filters(rootsFilter).pipe(
        // Only the first patch of a series carries the status and comments
        filter((event) => event.kind === GIT_PULL_REQUEST_KIND || isGitPatchRoot(event)),
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
          load(`${key}:replies`, {
            relays,
            filter: { kinds: [COMMENT_KIND, GIT_PULL_REQUEST_UPDATE_KIND], "#E": ids },
          }),
        );
      }, 4),
    );

    return merge(direct$, activity$).pipe(
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
          loads: all.length,
          done: all.every((status) => status.done),
          elapsed: Date.now() - start,
        };
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

/** All PRs and root patches of the repository with their status and last activity, read only from the event store */
function pullRequestRows$(pointer: GitRepositoryPointer): Observable<Row[]> {
  return combineLatest([
    eventStore.model(GitRepositoryPullRequestsModel, pointer).pipe(castTimelineStream(GitPullRequest, eventStore)),
    eventStore.model(GitRepositoryPatchesModel, pointer).pipe(castTimelineStream(GitPatch, eventStore)),
  ]).pipe(
    // Rebuild the per-thread subscriptions at most every 100ms while PRs stream in
    auditTime(100),
    map(([prs, patches]): Thread[] => [...prs, ...patches]),
    switchMap((threads) =>
      threads.length === 0
        ? of([])
        : combineLatest(
            threads.map((pr) =>
              combineLatest([pr.status$, pr.updatedAt$]).pipe(
                map(([status, updatedAt]): Row => ({ pr, status, updatedAt })),
              ),
            ),
          ),
    ),
    auditTime(100),
  );
}

/** Applies the sidebar view, author, label and search filters (everything except the status tab) */
function applyQuery(rows: Row[], query: Query, pubkey?: string) {
  const search = query.search.trim().toLowerCase();
  const recent = unixNow() - 7 * 86400;
  return rows.filter(({ pr, updatedAt }) => {
    if (query.view === "created" && pr.event.pubkey !== pubkey) return false;
    if (query.view === "mentioned" && !pr.event.tags.some((t) => t[0] === "p" && t[1] === pubkey)) return false;
    if (query.view === "recent" && updatedAt < recent) return false;
    if (query.author && pr.event.pubkey !== query.author) return false;
    if (query.label && !pr.labels.includes(query.label)) return false;
    if (search && !pr.title.toLowerCase().includes(search)) return false;
    return true;
  });
}

function sortRows(rows: Row[], sort: Query["sort"]) {
  const key = (row: Row) => (sort === "updated" ? row.updatedAt : row.pr.event.created_at);
  return [...rows].sort((a, b) => (sort === "oldest" ? key(a) - key(b) : key(b) - key(a)));
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

function StatusIcon({ status }: { status: GitStatus }) {
  if (status === "applied") return <GitMerge size={16} className="text-secondary shrink-0" />;
  if (status === "closed") return <GitPullRequestClosed size={16} className="text-error shrink-0" />;
  if (status === "draft") return <GitPullRequestDraft size={16} className="text-base-content/50 shrink-0" />;
  return <GitPullRequestIcon size={16} className="text-success shrink-0" />;
}

/** Labels the author like GitHub does: a maintainer, someone with merged work, or a first-time contributor */
function ContributorBadge({ role }: { role: "maintainer" | "contributor" | "first-time" }) {
  const label =
    role === "maintainer" ? "Maintainer" : role === "contributor" ? "Contributor" : "First-time contributor";
  return <span className="badge badge-outline">{label}</span>;
}

/** The current fetchable tip and number of valid updates */
function PullRequestState({ pr }: { pr: GitPullRequest }) {
  const updates = use$(pr.updates$);
  const state = use$(pr.state$);
  if (!state) return null;
  return (
    <span
      className="flex items-center gap-1 text-sm text-base-content/60"
      title={`Fetch ${state.tipCommit} from ${state.cloneUrls.join(", ")}`}
    >
      <GitCommitHorizontal size={14} /> <code>{state.tipCommit.slice(0, 7)}</code>
      {updates?.length ? <span>· {updates.length} updates</span> : null}
    </span>
  );
}

function UserName({ pubkey }: { pubkey: string }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);
  return <>{getDisplayName(profile, pubkey.slice(0, 8))}</>;
}

function PullRequestRow({
  row,
  role,
  onLabel,
}: {
  row: Row;
  role: "maintainer" | "contributor" | "first-time";
  onLabel: (label: string) => void;
}) {
  const { pr, status } = row;
  const comments = use$(pr.comments$);

  return (
    <div className="flex items-start gap-3 px-4 py-2 border-b border-base-300 last:border-b-0 hover:bg-base-200">
      <div className="pt-1">
        <StatusIcon status={status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{pr.title || "Untitled"}</span>
          {pr instanceof GitPatch ? <span className="badge badge-ghost">patch</span> : null}
          {pr.labels.map((label) => (
            <button key={label} className="badge badge-outline" onClick={() => onLabel(label)}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-base-content/60">
          <span>
            #{pr.id.slice(0, 7)} · <UserName pubkey={pr.event.pubkey} />{" "}
            {status === "applied" ? "merged, opened" : status === "closed" ? "closed, opened" : "opened"}{" "}
            {timeAgo(pr.event.created_at)}
          </span>
          <ContributorBadge role={role} />
          {pr instanceof GitPullRequest && pr.branchName ? <code>{pr.branchName}</code> : null}
        </div>
      </div>
      {pr instanceof GitPullRequest ? <PullRequestState pr={pr} /> : null}
      {comments?.length ? (
        <span className="flex items-center gap-1 text-sm text-base-content/60">
          <MessageSquare size={14} /> {comments.length}
        </span>
      ) : null}
    </div>
  );
}

/** A dropdown that picks one value from a list, or clears the selection */
function FilterDropdown<T extends string>({
  label,
  options,
  value,
  onChange,
  render = (v) => v,
}: {
  label: string;
  options: T[];
  value: T | null;
  onChange: (value: T | null) => void;
  render?: (value: T) => ReactNode;
}) {
  return (
    <div className="dropdown dropdown-end">
      <div tabIndex={0} role="button" className={`btn btn-ghost ${value ? "text-primary" : ""}`}>
        {label} <ChevronDown size={14} />
      </div>
      <ul tabIndex={0} className="dropdown-content menu bg-base-100 border border-base-300 rounded-box z-10 w-64 p-2">
        {value ? (
          <li>
            <button onClick={() => onChange(null)}>Clear filter</button>
          </li>
        ) : null}
        {options.map((option) => (
          <li key={option}>
            <button className={option === value ? "menu-active" : ""} onClick={() => onChange(option)}>
              {render(option)}
            </button>
          </li>
        ))}
        {options.length === 0 ? <li className="menu-disabled px-3 py-1">Nothing to filter</li> : null}
      </ul>
    </div>
  );
}

function SyncBanner({ summary }: { summary?: SyncSummary }) {
  if (!summary) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-base-content/60">
      {summary.done ? null : <span className="loading loading-spinner loading-sm" />}
      {summary.done ? "Synced" : "Syncing"} {summary.relays} relays ({summary.negentropy} with negentropy) ·{" "}
      {summary.events} events in {(summary.elapsed / 1000).toFixed(1)}s
    </div>
  );
}

/** Pick a repository by pasting an naddr, or from your own repositories when signed in */
function RepositoryPicker({ user, onSignIn }: { user?: User; onSignIn: () => void }) {
  const input$ = useMemo(() => new BehaviorSubject(""), []);
  const input = use$(input$);
  const selected = use$(repo$);

  // Sync your repository announcements from your outboxes when signed in
  use$(
    () =>
      user?.outboxes$.pipe(
        defined(),
        switchMap((relays) =>
          load("repos", { relays, filter: { kinds: [GIT_REPOSITORY_KIND], authors: [user.pubkey] } }),
        ),
      ),
    [user?.pubkey],
  );
  const repos = use$(() => user?.gitRepositories$, [user?.pubkey]);

  const pointer = input.trim() ? normalizeToAddressPointer(input.trim().replace(/^nostr:/, "")) : null;
  const invalid = input.trim() !== "" && pointer?.kind !== GIT_REPOSITORY_KIND;
  const open = () => {
    if (pointer?.kind !== GIT_REPOSITORY_KIND) return;
    repo$.next(pointer as GitRepositoryPointer);
    input$.next("");
  };
  const select = (repo: GitRepository) => repo$.next({ ...repo.pointer, relays: repo.relays.slice(0, 3) });

  return (
    <div className="flex flex-wrap gap-2">
      <input
        className={`input flex-1 min-w-64 ${invalid ? "input-error" : ""}`}
        placeholder="Paste a repository naddr..."
        value={input}
        onChange={(e) => input$.next(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && open()}
      />
      <button className="btn" disabled={invalid || !pointer} onClick={open}>
        Open
      </button>
      {user ? (
        <select
          className="select w-64"
          value={selected ? getReplaceableAddressFromPointer(selected) : ""}
          onChange={(e) => {
            const repo = repos?.find((r) => r.coordinate === e.target.value);
            if (repo) select(repo);
          }}
        >
          <option value="" disabled>
            {repos?.length ? "Your repositories" : "No repositories found"}
          </option>
          {repos?.map((repo) => (
            <option key={repo.uid} value={repo.coordinate!}>
              {repo.name || repo.identifier}
            </option>
          ))}
        </select>
      ) : (
        <button className="btn btn-ghost" onClick={onSignIn}>
          Sign in to pick your repositories
        </button>
      )}
    </div>
  );
}

function RepositoryHeader({ pointer }: { pointer: GitRepositoryPointer }) {
  const repo = use$(
    () => eventStore.replaceable(pointer).pipe(castEventStream(GitRepository, eventStore)),
    [getReplaceableAddressFromPointer(pointer)],
  );
  const owner = use$(() => castUser(pointer.pubkey, eventStore).profile$, [pointer.pubkey]);

  return (
    <div className="flex items-center gap-3 border-b border-base-300 pb-4">
      <img src={getProfilePicture(owner, `https://robohash.org/${pointer.pubkey}`)} className="size-10 rounded-full" />
      <div className="min-w-0">
        <h1 className="text-xl font-semibold truncate">
          {getDisplayName(owner, pointer.pubkey.slice(0, 8))} / {repo?.name || pointer.identifier}
        </h1>
        {repo?.description ? <p className="text-base-content/60 truncate">{repo.description}</p> : null}
      </div>
      <a
        className="btn btn-ghost ms-auto"
        href={`https://gitworkshop.dev/${naddrEncode(pointer)}`}
        target="_blank"
        rel="noreferrer"
      >
        gitworkshop.dev
      </a>
    </div>
  );
}

const SIDEBAR: { view: Query["view"]; label: string; signedIn?: boolean }[] = [
  { view: "all", label: "Pull requests" },
  { view: "created", label: "Authored by me", signedIn: true },
  { view: "mentioned", label: "Involves me", signedIn: true },
  { view: "recent", label: "Recent activity" },
];

const STATES: { state: GitStatus; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "draft", label: "Draft" },
  { state: "applied", label: "Merged" },
  { state: "closed", label: "Closed" },
];

const DEFAULT_QUERY: Query = { view: "all", state: "open", author: null, label: null, sort: "newest", search: "" };

function PullRequestsView({ pointer, user }: { pointer: GitRepositoryPointer; user?: User }) {
  const coord = getReplaceableAddressFromPointer(pointer);
  const query$ = useMemo(() => new BehaviorSubject<Query>(DEFAULT_QUERY), []);
  const query = use$(query$);
  const update = (changes: Partial<Query>) => query$.next({ ...query$.value, ...changes });
  const limit$ = useMemo(() => new BehaviorSubject(PAGE_SIZE), []);
  const limit = use$(limit$);

  const summary = use$(() => pullRequestsSync$(pointer), [coord]);
  const rows = use$(() => pullRequestRows$(pointer), [coord]);
  const repo = use$(() => eventStore.replaceable(pointer).pipe(castEventStream(GitRepository, eventStore)), [coord]);

  const filtered = useMemo(() => applyQuery(rows ?? [], query, user?.pubkey), [rows, query, user?.pubkey]);
  const counts = useMemo(() => {
    const counts: Partial<Record<GitStatus, number>> = {};
    for (const row of filtered) counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, [filtered]);
  const visible = sortRows(
    filtered.filter((row) => row.status === query.state),
    query.sort,
  );
  const stateLabel = STATES.find((s) => s.state === query.state)?.label ?? query.state;

  const authors = useMemo(() => [...new Set((rows ?? []).map((r) => r.pr.event.pubkey))], [rows]);
  const labels = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.pr.labels))].sort(), [rows]);

  // Authors with merged work are contributors, everyone else is new to the repository
  const roleOf = useMemo(() => {
    const maintainers = new Set(repo?.maintainerPubkeys ?? [pointer.pubkey]);
    const merged = new Set((rows ?? []).filter((r) => r.status === "applied").map((r) => r.pr.event.pubkey));
    return (pubkey: string) =>
      maintainers.has(pubkey) ? "maintainer" : merged.has(pubkey) ? "contributor" : ("first-time" as const);
  }, [repo, rows, pointer.pubkey]);

  return (
    <div className="flex min-h-0 grow w-full">
      <aside className="w-56 shrink-0 border-r border-base-300 p-3">
        <ul className="menu w-full p-0">
          {SIDEBAR.map((item) => (
            <li key={item.view} className={item.signedIn && !user ? "menu-disabled" : ""}>
              <button
                className={query.view === item.view ? "menu-active" : ""}
                disabled={item.signedIn && !user}
                onClick={() => update({ view: item.view })}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <main className="min-h-0 flex-1 min-w-0 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          <RepositoryHeader pointer={pointer} />

          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold flex-1">Pull requests</h2>
            <SyncBanner summary={summary} />
          </div>

          <input
            className="input w-full"
            placeholder="Search pull requests by title"
            value={query.search}
            onChange={(e) => update({ search: e.target.value })}
          />

          <div className="border border-base-300 rounded-box">
            <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-base-300 bg-base-200">
              {STATES.map(({ state, label }) => (
                <button
                  key={state}
                  className={`btn btn-ghost ${query.state === state ? "font-semibold" : "text-base-content/60"}`}
                  onClick={() => update({ state })}
                >
                  <StatusIcon status={state} />
                  {label}
                  <span className="badge">{counts[state] ?? 0}</span>
                </button>
              ))}
              <div className="flex-1" />
              <FilterDropdown
                label="Author"
                options={authors}
                value={query.author}
                onChange={(author) => update({ author })}
                render={(pubkey) => <UserName pubkey={pubkey} />}
              />
              <FilterDropdown
                label="Label"
                options={labels}
                value={query.label}
                onChange={(label) => update({ label })}
              />
              <select
                className="select select-ghost w-44"
                value={query.sort}
                onChange={(e) => update({ sort: e.target.value as Query["sort"] })}
              >
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="updated">Recently updated</option>
              </select>
            </div>

            {!rows ? (
              <div className="p-6 text-center">
                <span className="loading loading-dots" />
              </div>
            ) : visible.length === 0 ? (
              <div className="p-6 text-center text-base-content/60">
                {summary?.done ? `No ${stateLabel.toLowerCase()} pull requests` : "Looking for pull requests..."}
              </div>
            ) : (
              visible
                .slice(0, limit)
                .map((row) => (
                  <PullRequestRow
                    key={row.pr.id}
                    row={row}
                    role={roleOf(row.pr.event.pubkey)}
                    onLabel={(label) => update({ label })}
                  />
                ))
            )}
            {visible.length > limit ? (
              <button className="btn btn-ghost w-full text-primary" onClick={() => limit$.next(limit + PAGE_SIZE)}>
                Load more
              </button>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Clears the cache before picking a repository, for testing a fresh sync */
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

export default function RepositoryPullRequests() {
  const user = use$(user$);
  const pointer = use$(repo$);
  const signIn$ = useMemo(() => new BehaviorSubject(false), []);
  const signingIn = use$(signIn$);

  const handleLogin = useCallback(async (signer: ISigner, pubkey: string) => {
    signer$.next(signer);
    pubkey$.next(pubkey);
    signIn$.next(false);
  }, []);

  if (signingIn) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="flex flex-col min-h-0 grow w-full">
      <div className="border-b border-base-300 p-3">
        <RepositoryPicker user={user} onSignIn={() => signIn$.next(true)} />
      </div>
      {pointer ? (
        <PullRequestsView key={getReplaceableAddressFromPointer(pointer)} pointer={pointer} user={user} />
      ) : (
        <div className="p-6 space-y-3">
          <p className="text-base-content/60">Paste a repository naddr or sign in to pick one of yours.</p>
          <ClearCache />
        </div>
      )}
    </div>
  );
}
