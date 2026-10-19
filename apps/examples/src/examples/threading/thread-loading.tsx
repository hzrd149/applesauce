/**
 * Sync massive hell threads of NIP-10 replies, NIP-22 comments and reactions while skipping dead relays using NIP-66 monitors and local liveness
 * @tags nip-10, nip-22, nip-25, nip-66, nip-77, thread, replies, sync, negentropy, liveness, loader, stress
 * @related loader/sync-loader, relay/remote-monitor-liveness, relay/local-liveness
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Reaction, RelayDiscovery } from "applesauce-common/casts";
import { RELAY_DISCOVERY_KIND } from "applesauce-common/helpers";
import { ReactionsModel, Thread, ThreadItem, ThreadModel } from "applesauce-common/models";
import { castTimelineStream } from "applesauce-common/observable";
import { castEvent, castUser, defined, EventStore } from "applesauce-core";
import { Filter, kinds, mergeRelaySets, NostrEvent } from "applesauce-core/helpers";
import { decodeEventPointer } from "applesauce-core/helpers/pointers";
import { RemoteMonitorRelayLiveness } from "applesauce-extra";
import {
  createEventLoaderForStore,
  createSyncLoader,
  SyncLoaderResult,
  SyncLoaderStatus,
  SyncRelayStatus,
} from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayLiveness, RelayPool } from "applesauce-relay";
import { useMemo, useState } from "react";
import {
  auditTime,
  bufferTime,
  catchError,
  combineLatest,
  concat,
  defer,
  distinct,
  filter,
  from,
  map,
  merge,
  mergeMap,
  scan,
  Observable,
  of,
  startWith,
  switchMap,
  take,
  timeout,
} from "rxjs";
import NoteContent from "../../components/note-content";
import { lookupRelays$ } from "../../settings";

/** A known large thread to test loading against */
type ThreadPreset = { label: string; id: string; relays: string[]; expect: string };

// Smallest to largest. Reply and comment counts and p tags were probed with nak on 2026-10-19. relay.mostr.pub, where the
// 2023 threads lived, now redirects to relay.ditto.pub and browsers do not follow websocket redirects
const THREAD_PRESETS: ThreadPreset[] = [
  {
    label: "Mic check one two (2026)",
    id: "32db6036581719ab1f028aaa0a643f924d509a8f0f9d4fd257340bead701d204",
    relays: ["wss://relay.primal.net/"],
    expect: "17 replies, ~1100 p tags each",
  },
  {
    label: "Holiday giveaway (2025)",
    id: "3822b30a693a9d0bfd18635fa9271dcb0c15b3b96a14155203da58c71563ee04",
    relays: ["wss://relay.primal.net/"],
    expect: "26 replies, 485 p tag root (98 KB)",
  },
  {
    label: "Plebeian Market GM (2026)",
    id: "06f121f326b094838c388a8616294974e0efe3893f94ead9c6ad2cbb64dfe12e",
    relays: ["wss://relay.primal.net/"],
    expect: "46 replies, 919 p tag root (133 KB)",
  },
  {
    label: "Grok by August (2026)",
    id: "565620108a2dc61beccd17a22d3fcba60624a83e5b1f704ddc686aa00b5a85da",
    relays: ["wss://relay.ditto.pub/"],
    expect: "129 nested NIP-22 comments",
  },
  {
    label: "Zap Wave #5 (2023)",
    id: "350b1e92991a30ea22a6701b086e5a91aea748c0fbaddfc9e076972630275b9a",
    relays: ["wss://relay.ditto.pub/", "wss://nostr.land/"],
    expect: "310 replies, ~250 p tags each",
  },
  {
    label: "Zap Wave 6 (2023)",
    id: "73c7544de93dff9ff30f0e2109b63f94ffe29e1dee1abc4addf51de4d68a8b4a",
    relays: ["wss://relay.ditto.pub/", "wss://nostr.land/"],
    expect: "643 replies, ~420 p tags each (17 MB)",
  },
  {
    label: "Cornychat rockstar (2025)",
    id: "5057950f0b222bf8c308270022c569c129f831fed57b22af689ab18534bbce26",
    relays: ["wss://relay.ditto.pub/", "wss://nostr.mom/", "wss://nostr.land/"],
    expect: "1157 replies, ~400 p tags each, over ditto's 1000 limit",
  },
];

/** Parses a hex id, note1, or nevent (with or without "nostr:") into a thread root id and relay hints */
function parseThreadInput(text: string): { id: string; relays: string[] } | null {
  const value = text.trim().replace(/^nostr:/, "");
  if (/^[0-9a-f]{64}$/i.test(value)) return { id: value.toLowerCase(), relays: [] };

  try {
    const pointer = decodeEventPointer(value);
    return pointer ? { id: pointer.id, relays: pointer.relays ?? [] } : null;
  } catch {
    return null;
  }
}

/** A single row of the flattened thread */
type ThreadRow =
  | { type: "item"; key: string; item: ThreadItem; depth: number; root?: boolean; orphan?: boolean }
  | { type: "missing"; key: string; parentId: string; count: number }
  | { type: "section"; key: string; label: string; count: number };

/** The shape of the loaded thread */
type TreeStats = { items: number; maxDepth: number; orphans: number; missingParents: number; mentions: number };

const byCreated = (a: ThreadItem, b: ThreadItem) => a.event.created_at - b.event.created_at;

/** Flattens a thread into depth-indented rows for a virtualized list, orphans and mentions are grouped at the end */
function flattenThread(
  thread: Thread,
  rootId: string,
  collapsed: Set<string>,
): { rows: ThreadRow[]; stats: TreeStats } {
  const rows: ThreadRow[] = [];
  const stats: TreeStats = {
    items: thread.all.size,
    maxDepth: 0,
    orphans: 0,
    missingParents: 0,
    mentions: 0,
  };

  const orphans = new Map<string, ThreadItem[]>();
  const mentions: ThreadItem[] = [];
  for (const item of thread.all.values()) {
    if (item.event.id === rootId || item.parent) continue;
    // Replies whose parent hasn't loaded (or isn't part of this thread)
    const parentId = item.refs.reply?.e?.id;
    if (parentId) {
      const group = orphans.get(parentId);
      if (group) group.push(item);
      else orphans.set(parentId, [item]);
      stats.orphans++;
    } else {
      mentions.push(item);
      stats.mentions++;
    }
  }
  stats.missingParents = orphans.size;

  // Iterative DFS so deep reply chains can't overflow the stack
  const walk = (start: ThreadItem, depth: number, orphan?: boolean) => {
    const stack: [ThreadItem, number][] = [[start, depth]];
    while (stack.length > 0) {
      const [item, d] = stack.pop()!;
      rows.push({
        type: "item",
        key: item.event.id,
        item,
        depth: d,
        root: item === thread.root,
        orphan: orphan && item === start,
      });
      if (d > stats.maxDepth) stats.maxDepth = d;
      if (collapsed.has(item.event.id)) continue;

      const children = [...item.replies].sort(byCreated);
      for (let i = children.length - 1; i >= 0; i--) stack.push([children[i], d + 1]);
    }
  };

  if (thread.root) walk(thread.root, 0);

  if (orphans.size > 0) {
    rows.push({ type: "section", key: "section:orphans", label: "Missing parents", count: stats.orphans });
    for (const [parentId, items] of orphans) {
      rows.push({ type: "missing", key: `missing:${parentId}`, parentId, count: items.length });
      for (const item of items.sort(byCreated)) walk(item, 1, true);
    }
  }

  if (mentions.length > 0) {
    rows.push({ type: "section", key: "section:mentions", label: "Mentions", count: mentions.length });
    for (const item of mentions.sort(byCreated)) walk(item, 0);
  }

  return { rows, stats };
}

const COMMON_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/", "wss://relay.ditto.pub/"];

// The two most active NIP-66 monitors on 2026-10-19, both publish to these relays
const MONITOR_RELAYS = ["wss://relay.nostr.watch/", "wss://monitorlizard.nostr1.com/"];
const MONITORS = [
  { name: "Broodje Zeedijk", pubkey: "9bbbb845e5b6c831c29789900769843ab43bb5047abe697870cb50b6fc9bf923" },
  { name: "Ghost", pubkey: "45df0580711f37c547270480d7aed2c7fc03ba5a4f8fef5a8787db0b19343de0" },
];

const eventStore = new EventStore();

// Local liveness records this client's own failures, a relay that times out is skipped while it backs off
const local = new RelayLiveness();

// Monitors only see global outages, a relay both monitors stopped reporting is skipped
const monitors = new RemoteMonitorRelayLiveness(eventStore, {
  monitors: MONITORS.map(({ pubkey }) => ({ pubkey, relays: MONITOR_RELAYS })),
  staleAsOffline: true,
  maxAge: 24 * 60 * 60_000,
  // Stale reports are the oldest ones, so the limit has to cover every relay a monitor has reported on
  limit: 5000,
});

// The pool skips relays either source considers unhealthy and connects both sources to its relays
const pool = new RelayPool({ liveness: [local, monitors] });

// Profiles for the visible rows load on demand through the unified loader
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Negentropy when the relay supports NIP-77, paginated REQs otherwise. Relays that fail are reported to local liveness
const syncLoader = createSyncLoader({ eventStore, pool, liveness: local });

type RunConfig = {
  id: string;
  relays: string[];
  inboxes: boolean;
  reactions: boolean;
  limit: number;
  concurrency: number;
  timeout: number;
};

type Stage = "root" | "replies" | "comments" | "reactions";
const STAGES: Stage[] = ["root", "replies", "comments", "reactions"];

/** A relay's status in one stage with when it returned its first event and when it finished */
type RelayTiming = SyncRelayStatus & { first?: number; finished?: number };

type StageState = {
  relays: Record<string, RelayTiming>;
  loaded: number;
  /** When the first event arrived */
  first?: number;
  /** When the last relay that succeeded finished */
  complete?: number;
  /** When every relay finished, failed or was skipped */
  settled?: number;
  /** Reaction batches finished and started */
  batches?: { done: number; total: number };
};

type RunState = {
  config: RunConfig;
  stages: Record<Stage, StageState>;
  samples: { t: number; loaded: number }[];
  ms: number;
  loaded: number;
  done: boolean;
  /** Thread events already in the store when the run started */
  cached: number;
};

const threadFilters = (id: string) => ({
  root: { ids: [id] } satisfies Filter,
  replies: { kinds: [kinds.ShortTextNote], "#e": [id] } satisfies Filter,
  // NIP-22 comments tag the root with "E" at every depth, so one filter loads the whole comment tree
  comments: { kinds: [kinds.Comment], "#E": [id] } satisfies Filter,
});

// Reactions are loaded by the ids of thread events, a batch keeps each REQ filter a reasonable size
const REACTION_BATCH = 250;

/** The ids of every thread event in the store */
const threadIds = (id: string) => eventStore.getByFilters(Object.values(threadFilters(id))).map((event) => event.id);

/** The root author's NIP-65 inboxes, or none if the root or their relay list doesn't load within 5s */
function rootInboxes$(id: string): Observable<string[]> {
  return eventStore.event(id).pipe(
    defined(),
    take(1),
    switchMap((root) => castUser(root.pubkey, eventStore).inboxes$),
    defined(),
    take(1),
    timeout({ first: 5_000, with: () => of([]) }),
  );
}

/** The relays a run loads from. The list completes so the sync loader knows when every load is finished */
function threadRelays$(config: RunConfig): Observable<string[]> {
  if (!config.inboxes) return of(config.relays);

  // Start with the run relays, then add the root author's inboxes once they're known
  return concat(
    of(config.relays),
    rootInboxes$(config.id).pipe(map((inboxes) => mergeRelaySets(config.relays, inboxes))),
  );
}

/** Reaction batches loaded so far and how many have been started */
type ReactionProgress = { batches: SyncLoaderStatus[]; total: number; done: boolean };

/** The latest status of every load, before it is folded into the run state */
type Snapshot = {
  root?: SyncLoaderStatus;
  replies?: SyncLoaderStatus;
  comments?: SyncLoaderStatus;
  reactions: ReactionProgress;
};

const NO_REACTIONS: ReactionProgress = { batches: [], total: 0, done: true };

/** Starts a sync load of one filter from the run's relays */
function load(config: RunConfig, filter: Filter): SyncLoaderResult {
  return syncLoader({
    relays: threadRelays$(config),
    filter,
    limit: config.limit,
    concurrency: config.concurrency,
    timeout: config.timeout,
    // Paid relays like nostr.land require auth, fail fast instead of waiting for a signer
    waitForAuth: false,
  });
}

/** The id of every thread event as it arrives, starting with the ones already in the store */
function threadIds$(id: string, loads: SyncLoaderResult[]): Observable<string> {
  return merge(
    // Negentropy doesn't transfer events the store already has, so their ids come from the store
    from(eventStore.getByFilters(Object.values(threadFilters(id)))),
    ...loads.map((load) => load.events$),
  ).pipe(
    map((event) => event.id),
    distinct(),
  );
}

/** Loads reactions for batches of thread ids as they arrive, so reactions never wait on the slowest relay */
function reactions$(config: RunConfig, ids$: Observable<string>): Observable<ReactionProgress> {
  return defer(() => {
    let total = 0;
    let latest: ReactionProgress = { batches: [], total: 0, done: false };

    const batches$ = ids$.pipe(
      // Collect ids for a second, or until a batch is full
      bufferTime(1000, null, REACTION_BATCH),
      filter((ids) => ids.length > 0),
      map((ids) => ({ index: total++, ids })),
    );

    const progress$ = batches$.pipe(
      // Two batches at a time so a large thread doesn't flood the relays
      mergeMap(
        ({ index, ids }) =>
          load(config, { kinds: [kinds.Reaction], "#e": ids }).status$.pipe(map((status) => ({ index, status }))),
        2,
      ),
      scan((batches, { index, status }) => Object.assign([...batches], { [index]: status }), [] as SyncLoaderStatus[]),
      startWith([] as SyncLoaderStatus[]),
      map((batches) => (latest = { batches, total, done: false })),
    );

    // The ids complete when the thread loads finish, so the stage is done once the last batch completes
    return concat(
      progress$,
      defer(() => of({ ...latest, done: true })),
    );
  });
}

/** Syncs the root, replies, comments and their reactions in parallel and tracks network timing */
function sync$(config: RunConfig): Observable<RunState | Error> {
  return defer(() => {
    const filters = threadFilters(config.id);
    const start = performance.now();
    const initial: RunState = {
      config,
      stages: { root: EMPTY_STAGE, replies: EMPTY_STAGE, comments: EMPTY_STAGE, reactions: EMPTY_STAGE },
      samples: [],
      ms: 0,
      loaded: 0,
      done: false,
      cached: threadIds(config.id).length,
    };

    // The loader reconciles a single filter, so each part of the thread is its own load
    const root = load(config, filters.root);
    const replies = load(config, filters.replies);
    const comments = load(config, filters.comments);

    return combineLatest({
      root: root.status$.pipe(startWith(undefined)),
      replies: replies.status$.pipe(startWith(undefined)),
      comments: comments.status$.pipe(startWith(undefined)),
      reactions: config.reactions
        ? reactions$(config, threadIds$(config.id, [root, replies, comments]))
        : of(NO_REACTIONS),
    }).pipe(
      scan((run: RunState, snapshot: Snapshot) => updateRun(run, snapshot, performance.now() - start), initial),
      catchError((error: Error) => of(error)),
    );
  });
}

const TERMINAL = ["complete", "error", "skipped"];
const EMPTY_STAGE: StageState = { relays: {}, loaded: 0 };

/** Folds the latest load statuses into the run state */
function updateRun(run: RunState, snapshot: Snapshot, now: number): RunState {
  // The clock stops once every stage has settled
  const ms = run.done ? run.ms : now;
  const reactions = mergeBatches(snapshot.reactions);
  const { batches, total } = snapshot.reactions;

  const stages: Record<Stage, StageState> = {
    root: trackStage(run.stages.root, snapshot.root, ms),
    replies: trackStage(run.stages.replies, snapshot.replies, ms),
    comments: trackStage(run.stages.comments, snapshot.comments, ms),
    reactions: {
      ...trackStage(run.stages.reactions, reactions, ms),
      batches: { done: batches.filter((b) => b?.done).length, total },
    },
  };

  const done = STAGES.every((stage) => stages[stage].settled !== undefined);
  const loaded = STAGES.reduce((sum, stage) => sum + stages[stage].loaded, 0);
  const samples = run.done ? run.samples : [...run.samples, { t: ms, loaded }];

  return { ...run, stages, samples, ms, loaded, done };
}

/** Updates a stage's timings, remembering when each relay first returned events and when it finished */
function trackStage(prev: StageState, status: SyncLoaderStatus | undefined, ms: number): StageState {
  const relays: Record<string, RelayTiming> = {};
  for (const relay of Object.values(status?.relays ?? {})) {
    const before = prev.relays[relay.relay];
    const finished = TERMINAL.includes(relay.state);
    // A relay finishes again after each reaction batch, so keep the time of its latest finish
    const finishedBefore = before?.finished !== undefined && TERMINAL.includes(before.state);

    relays[relay.relay] = {
      ...relay,
      first: before?.first ?? (relay.count > 0 ? ms : undefined),
      finished: finished ? (finishedBefore ? before.finished : ms) : undefined,
    };
  }

  const loaded = status?.loaded ?? 0;
  const succeeded = Object.values(relays).flatMap((r) => (r.state === "complete" ? [r.finished!] : []));
  return {
    relays,
    loaded,
    first: prev.first ?? (loaded > 0 ? ms : undefined),
    complete: succeeded.length > 0 ? Math.max(...succeeded) : undefined,
    settled: status?.done ? (prev.settled ?? ms) : undefined,
  };
}

/** Combines each relay's status across reaction batches into one status for the stage */
function mergeBatches({ batches, done }: ReactionProgress): SyncLoaderStatus {
  const byRelay = new Map<string, SyncRelayStatus[]>();
  for (const batch of batches) {
    if (!batch) continue;
    for (const status of Object.values(batch.relays))
      byRelay.set(status.relay, [...(byRelay.get(status.relay) ?? []), status]);
  }

  const relays: Record<string, SyncRelayStatus> = {};
  for (const [relay, list] of byRelay) {
    const states = list.map((s) => s.state);
    let state: SyncRelayStatus["state"] = "error";
    if (states.some((s) => !TERMINAL.includes(s))) state = "loading";
    else if (states.every((s) => s === "skipped")) state = "skipped";
    else if (states.includes("complete")) state = "complete";

    relays[relay] = {
      relay,
      state,
      method: list.find((s) => s.method)?.method,
      count: list.reduce((sum, s) => sum + s.count, 0),
      error: list.find((s) => s.error)?.error,
    };
  }

  return { relays, loaded: batches.reduce((sum, b) => sum + (b?.loaded ?? 0), 0), done };
}

/** A fresh ThreadModel per view, the store's cached model would keep events removed by "Clear thread" */
function threadView$(id: string) {
  return defer(() =>
    ThreadModel(id)(eventStore).pipe(
      // Events are already in the store, this only limits how often the tree is rebuilt
      auditTime(250),
    ),
  );
}

type HistoryRow = { label: string; warm: boolean; complete?: number; settled: number; loaded: number };

const short = (relay: string) => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
const seconds = (ms?: number) => (ms === undefined ? "—" : `${(ms / 1000).toFixed(2)}s`);
const parseRelays = (text: string) => mergeRelaySets(text.split(/\s+/).filter((r) => r.startsWith("ws")));
const lastComplete = (state: RunState) => {
  const times = STAGES.flatMap((s) => (state.stages[s].complete !== undefined ? [state.stages[s].complete!] : []));
  return times.length > 0 ? Math.max(...times) : undefined;
};

export default function ThreadLoading() {
  const [preset, setPreset] = useState(THREAD_PRESETS[THREAD_PRESETS.length - 1].id);
  const [custom, setCustom] = useState("");
  const [extraText, setExtraText] = useState("");
  const [common, setCommon] = useState(false);
  const [inboxes, setInboxes] = useState(false);
  const [limit, setLimit] = useState(500);
  const [concurrency, setConcurrency] = useState(4);
  const [timeoutMs, setTimeoutMs] = useState(10_000);
  const [profiles, setProfiles] = useState(true);
  const [reactions, setReactions] = useState(true);
  const [run, setRun] = useState<RunConfig | null>(null);
  const [generation, setGeneration] = useState(0);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  // The tree keeps showing the last synced thread after the run is stopped
  const [viewId, setViewId] = useState<string>();
  const [tab, setTab] = useState<"network" | "thread">("network");

  const parsed = custom.trim() ? parseThreadInput(custom) : null;
  const selected = THREAD_PRESETS.find((p) => p.id === preset);
  const target = parsed ?? (selected ? { id: selected.id, relays: selected.relays } : null);

  const state = use$(() => (run ? sync$(run) : undefined), [run]);
  const progress = state instanceof Error ? undefined : state;
  const running = !!run && !progress?.done;

  const start = () => {
    if (!target) return;
    if (progress?.done) setHistory((h) => [summarize(progress), ...h].slice(0, 8));
    setViewId(target.id);
    setRun({
      id: target.id,
      relays: mergeRelaySets(target.relays, parseRelays(extraText), common ? COMMON_RELAYS : []),
      inboxes,
      reactions,
      limit,
      concurrency,
      timeout: timeoutMs,
    });
  };

  const clear = () => {
    if (!viewId) return;
    const ids = threadIds(viewId);
    if (ids.length > 0) eventStore.removeByFilters({ kinds: [kinds.Reaction], "#e": ids });
    eventStore.removeByFilters(Object.values(threadFilters(viewId)));
    setGeneration((g) => g + 1);
  };

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-e border-base-300 p-3">
        <section className="flex flex-col gap-1">
          <h2 className="font-semibold">Thread</h2>
          {THREAD_PRESETS.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                className="radio radio-sm mt-1"
                checked={!custom && preset === p.id}
                onChange={() => {
                  setPreset(p.id);
                  setCustom("");
                }}
              />
              <span>
                {p.label}
                <span className="block text-sm opacity-60">{p.expect}</span>
              </span>
            </label>
          ))}
          <input
            className="input w-full"
            placeholder="nevent, note1 or hex id"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
          {custom.trim() && !parsed && <span className="text-sm text-error">Not a valid event id</span>}
        </section>

        <section className="flex flex-col gap-1">
          <h2 className="font-semibold">Relays</h2>
          <p className="text-sm opacity-60">
            {target?.relays.length ? target.relays.map(short).join(", ") : "No relay hints"}
          </p>
          <textarea
            className="textarea w-full"
            rows={2}
            placeholder="Extra relays"
            value={extraText}
            onChange={(e) => setExtraText(e.target.value)}
          />
          <Toggle label="+ common relays" checked={common} onChange={setCommon} />
          <Toggle label="+ root author inboxes (NIP-65)" checked={inboxes} onChange={setInboxes} />
        </section>

        <section className="grid grid-cols-2 gap-2">
          <NumberSelect label="Page" value={limit} options={[100, 250, 500, 1000]} onChange={setLimit} />
          <NumberSelect label="Relays" value={concurrency} options={[1, 2, 4, 10]} onChange={setConcurrency} />
          <NumberSelect
            label="Timeout"
            value={timeoutMs}
            options={[5_000, 10_000, 30_000]}
            format={(ms) => `${ms / 1000}s`}
            onChange={setTimeoutMs}
          />
        </section>

        <section className="flex flex-col gap-1">
          <Toggle label="Load reactions" checked={reactions} onChange={setReactions} />
          <Toggle label="Load profiles" checked={profiles} onChange={setProfiles} />
        </section>

        <div className="flex flex-wrap gap-2">
          {running ? (
            <button className="btn btn-warning" onClick={() => setRun(null)}>
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" disabled={!target} onClick={start}>
              Sync
            </button>
          )}
          <button className="btn" disabled={running || !viewId} onClick={clear}>
            Clear thread
          </button>
        </div>

        <RunHistory history={history} />
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
        <div className="tabs tabs-border" role="tablist">
          {(["network", "thread"] as const).map((name) => (
            <button
              key={name}
              role="tab"
              className={`tab ${tab === name ? "tab-active" : ""}`}
              aria-selected={tab === name}
              onClick={() => setTab(name)}
            >
              {name === "network" ? "Network" : "Thread"}
            </button>
          ))}
        </div>
        {state instanceof Error && <div className="alert alert-error">{state.message}</div>}
        {/* The run summary stays visible on both tabs so loading progress can be followed while browsing */}
        {progress && <RunStats state={progress} running={running} />}

        {tab === "network" ? (
          <>
            <MonitorBar />
            {progress ? (
              <>
                <StageTable state={progress} />
                <RelayTable state={progress} />
              </>
            ) : (
              <p className="opacity-60">Pick a thread and press Sync.</p>
            )}
          </>
        ) : viewId ? (
          <ThreadTree key={`${viewId}:${generation}`} id={viewId} profiles={profiles} running={running} />
        ) : (
          <p className="opacity-60">Pick a thread and press Sync.</p>
        )}
      </main>
    </div>
  );
}

function summarize(state: RunState): HistoryRow {
  return {
    label: THREAD_PRESETS.find((p) => p.id === state.config.id)?.label ?? state.config.id.slice(0, 8),
    warm: state.cached > 0,
    complete: lastComplete(state),
    settled: state.ms,
    loaded: state.loaded,
  };
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        className="checkbox checkbox-sm"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

function NumberSelect({
  label,
  value,
  options,
  format = String,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  format?: (n: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {options.map((n) => (
        <option key={n} value={n}>
          {label} {format(n)}
        </option>
      ))}
    </select>
  );
}

/** What each liveness source currently knows */
function MonitorBar() {
  const errors = use$(monitors.errors$);
  const excluded = use$(monitors.unhealthy$);
  const backoff = use$(local.unhealthy$);

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
      {MONITORS.map((monitor) => (
        <MonitorReports key={monitor.pubkey} monitor={monitor} error={errors?.[monitor.pubkey]} />
      ))}
      <span title={excluded?.join("\n")}>
        Monitors exclude <strong>{excluded?.length ?? 0}</strong>
      </span>
      <span title={backoff?.join("\n")}>
        Local backoff <strong>{backoff?.length ?? 0}</strong>
      </span>
    </div>
  );
}

function MonitorReports({ monitor, error }: { monitor: (typeof MONITORS)[number]; error?: string }) {
  const reports = use$(
    () => eventStore.timeline({ kinds: [RELAY_DISCOVERY_KIND], authors: [monitor.pubkey] }).pipe(map((l) => l.length)),
    [monitor.pubkey],
  );
  return (
    <span className={error ? "text-error" : ""} title={error}>
      {monitor.name} <strong>{reports ?? 0}</strong> reports
    </span>
  );
}

function RunStats({ state, running }: { state: RunState; running: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-y border-base-300 py-2">
      <span>
        Complete <strong>{seconds(lastComplete(state))}</strong>
      </span>
      <span>
        {state.done ? "Settled" : "Elapsed"} <strong>{seconds(state.ms)}</strong>
      </span>
      <span>
        Events <strong>{state.loaded.toLocaleString()}</strong>
      </span>
      <span>
        Events/s <strong>{state.ms > 0 ? ((state.loaded / state.ms) * 1000).toFixed(0) : 0}</strong>
      </span>
      <span className={`badge ${state.cached > 0 ? "badge-info" : "badge-ghost"}`}>
        {state.cached > 0 ? `Warm, ${state.cached} cached` : "Cold"}
      </span>
      {state.done && <span className="badge badge-success">Done</span>}
      {!state.done && !running && <span className="badge badge-warning">Stopped</span>}
      <ProgressCurve state={state} />
    </div>
  );
}

/** Events loaded over time */
function ProgressCurve({ state }: { state: RunState }) {
  const samples = state.samples;
  const maxT = Math.max(samples[samples.length - 1]?.t ?? 0, 1);
  const maxN = Math.max(...samples.map((s) => s.loaded), 1);
  const points = samples.map((s) => `${(s.t / maxT) * 1000},${100 - (s.loaded / maxN) * 100}`).join(" ");
  return (
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="h-8 min-w-40 flex-1">
      <polyline
        points={points}
        fill="none"
        className="stroke-success"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** First event, completion and settle time for each part of the thread */
function StageTable({ state }: { state: RunState }) {
  return (
    <table className="table shrink-0 border border-base-300">
      <thead>
        <tr>
          <th>Stage</th>
          <th className="text-end">First event</th>
          <th className="text-end" title="When the last relay that succeeded finished">
            Complete
          </th>
          <th className="text-end" title="When every relay finished, failed or was skipped">
            Settled
          </th>
          <th className="text-end">Events</th>
          <th>Relays</th>
        </tr>
      </thead>
      <tbody>
        {STAGES.filter((stage) => stage !== "reactions" || state.config.reactions).map((stage) => {
          const s = state.stages[stage];
          const relays = Object.values(s.relays);
          const count = (st: string) => relays.filter((r) => r.state === st).length;
          return (
            <tr key={stage}>
              <td>
                {stage}
                {s.batches && (
                  <span className="opacity-60">
                    {" "}
                    · {s.batches.done}/{s.batches.total} batches
                  </span>
                )}
              </td>
              <td className="text-end">{seconds(s.first)}</td>
              <td className="text-end">{seconds(s.complete)}</td>
              <td className="text-end">{seconds(s.settled)}</td>
              <td className="text-end">{s.loaded.toLocaleString()}</td>
              <td>
                {count("complete")} ok
                {count("skipped") > 0 && <span className="opacity-60"> · {count("skipped")} skipped</span>}
                {count("error") > 0 && <span className="text-error"> · {count("error")} failed</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Each relay's liveness evidence and how it did in every stage */
function RelayTable({ state }: { state: RunState }) {
  const relays = [...new Set(STAGES.flatMap((stage) => Object.keys(state.stages[stage].relays)))];
  if (relays.length === 0) return null;

  return (
    <div className="min-h-0 overflow-y-auto border border-base-300">
      <table className="table">
        <thead>
          <tr>
            <th>Relay</th>
            {MONITORS.map((m) => (
              <th key={m.pubkey}>{m.name}</th>
            ))}
            <th>Local</th>
            {STAGES.filter((stage) => stage !== "reactions" || state.config.reactions).map((stage) => (
              <th key={stage}>{stage}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {relays.map((relay) => (
            <tr key={relay}>
              <td>{short(relay)}</td>
              {MONITORS.map((m) => (
                <MonitorCell key={m.pubkey} relay={relay} monitor={m.pubkey} />
              ))}
              <LocalCell relay={relay} />
              {STAGES.filter((stage) => stage !== "reactions" || state.config.reactions).map((stage) => (
                <StageCell key={stage} timing={state.stages[stage].relays[relay]} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A monitor's latest report for a relay: online with read latency, stale, or not tracked */
function MonitorCell({ relay, monitor }: { relay: string; monitor: string }) {
  const report = use$(
    () => eventStore.replaceable({ kind: RELAY_DISCOVERY_KIND, pubkey: monitor, identifier: relay }),
    [relay, monitor],
  );
  const consensus = use$(() => monitors.state(relay), [relay]);
  const observation = consensus?.observations.find((o) => o.monitor === monitor);

  if (!report) return <td className="opacity-60">not tracked</td>;
  const rtt = castEvent(report, RelayDiscovery, eventStore).rttRead;
  const age = Math.round((Date.now() / 1000 - report.created_at) / 3600);
  if (observation?.state === "offline") return <td className="text-warning">stale {age}h</td>;
  if (observation?.state === "online") return <td className="text-success">{rtt}ms</td>;
  return <td className="opacity-60">expired {age}h</td>;
}

/** This client's own record of the relay */
function LocalCell({ relay }: { relay: string }) {
  const state = use$(() => local.state(relay), [relay]);
  if (!state) return <td className="opacity-60">—</td>;
  if (state.state === "online") return <td className="text-success">online</td>;
  const backoff = Math.ceil(local.getBackoffRemaining(relay) / 1000);
  return (
    <td className="text-error">
      {state.state}
      {backoff > 0 && ` · ${backoff}s`}
    </td>
  );
}

function StageCell({ timing }: { timing?: RelayTiming }) {
  if (!timing) return <td className="opacity-60">—</td>;
  if (timing.state === "skipped") return <td className="opacity-60">skipped</td>;
  if (timing.state === "error")
    return (
      <td className="text-error" title={timing.error?.message}>
        failed {seconds(timing.finished)}
      </td>
    );
  return (
    <td className={timing.state === "complete" ? "" : "opacity-60"}>
      {timing.method === "negentropy" ? "neg" : timing.method === "request" ? "req" : timing.state} {timing.count}
      {timing.finished !== undefined && <span className="opacity-60"> · {seconds(timing.finished)}</span>}
    </td>
  );
}

function RunHistory({ history }: { history: HistoryRow[] }) {
  if (history.length === 0) return null;

  return (
    <section className="flex flex-col gap-1">
      <h2 className="font-semibold">Previous runs</h2>
      <table className="table">
        <tbody>
          {history.map((row, i) => (
            <tr key={i}>
              <td>
                {row.label}
                <span className="block opacity-60">{row.warm ? "warm" : "cold"}</span>
              </td>
              <td className="text-end">
                {seconds(row.complete)} / {seconds(row.settled)}
                <span className="block opacity-60">{row.loaded.toLocaleString()} events</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Builds the thread from the store and renders it as a virtualized list */
function ThreadTree({ id, profiles, running }: { id: string; profiles: boolean; running: boolean }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const thread = use$(() => threadView$(id), [id]);
  const flat = useMemo(() => (thread ? flattenThread(thread, id, collapsed) : undefined), [thread, id, collapsed]);

  const toggleCollapse = (eventId: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (!next.delete(eventId)) next.add(eventId);
      return next;
    });

  if (!thread || !flat)
    return <p className="opacity-60">{running ? "Syncing, no events yet…" : "No events in the store."}</p>;

  const { stats } = flat;
  return (
    <>
      <p className="opacity-60">
        {stats.items.toLocaleString()} events · depth {stats.maxDepth} · {stats.orphans} orphans under{" "}
        {stats.missingParents} missing parents · {stats.mentions} mentions
      </p>
      {!thread.root && !running && (
        <div className="alert alert-warning">The root event was not found on any relay.</div>
      )}
      <ThreadList rows={flat.rows} profiles={profiles} collapsed={collapsed} onCollapse={toggleCollapse} />
    </>
  );
}

function ThreadList({
  rows,
  profiles,
  collapsed,
  onCollapse,
}: {
  rows: ThreadRow[];
  profiles: boolean;
  collapsed: Set<string>;
  onCollapse: (id: string) => void;
}) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => rows[index].key,
    estimateSize: () => 96,
    overscan: 8,
  });

  const toggleExpand = (id: string) =>
    setExpanded((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto border border-base-300">
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const row = rows[v.index];
          return (
            <div
              key={v.key}
              data-index={v.index}
              ref={virtualizer.measureElement}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${v.start}px)` }}
            >
              {row.type === "item" ? (
                <ThreadItemRow
                  row={row}
                  profiles={profiles}
                  expanded={expanded.has(row.key)}
                  collapsed={collapsed.has(row.key)}
                  onExpand={() => toggleExpand(row.key)}
                  onCollapse={() => onCollapse(row.key)}
                />
              ) : row.type === "missing" ? (
                <div className="border-b border-base-300 bg-base-200 px-3 py-1">
                  Missing parent <code>{row.parentId.slice(0, 12)}…</code> · {row.count} replies
                </div>
              ) : (
                <div className="border-b border-base-300 bg-base-200 px-3 py-2 font-semibold">
                  {row.label} ({row.count})
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const MAX_INDENT = 12;

function ThreadItemRow({
  row,
  profiles,
  expanded,
  collapsed,
  onExpand,
  onCollapse,
}: {
  row: Extract<ThreadRow, { type: "item" }>;
  profiles: boolean;
  expanded: boolean;
  collapsed: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const event: NostrEvent = row.item.event;
  // Replies are kind 1 notes and comments are kind 1111, both only need their author here
  const author = castUser(event.pubkey, eventStore);
  const profile = use$(() => (profiles ? author.profile$ : undefined), [author, profiles]);
  const name = profile?.displayName || author.npub.slice(0, 12);

  return (
    <div
      className={`border-b border-base-300 py-2 pe-3 ${row.root ? "border-b-2" : ""}`}
      style={{ paddingInlineStart: 12 + Math.min(row.depth, MAX_INDENT) * 16 }}
    >
      <div className={row.depth > 0 ? "border-s-2 border-base-300 ps-3" : ""}>
        <div className="flex flex-wrap items-center gap-2">
          {profiles && profile?.picture ? (
            <img src={profile.picture} alt="" loading="lazy" className="h-6 w-6 rounded-full object-cover" />
          ) : (
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-base-300">
              {name[0]}
            </span>
          )}
          <span className="font-semibold">{name}</span>
          <span className="opacity-60">{new Date(event.created_at * 1000).toLocaleString()}</span>
          {row.root && <span className="badge badge-primary">root</span>}
          {row.orphan && <span className="badge badge-warning">missing parent</span>}
          {row.depth > MAX_INDENT && <span className="badge badge-ghost">depth {row.depth}</span>}
          {row.item.replies.size > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={onCollapse}>
              {collapsed ? "▸" : "▾"} {row.item.replies.size} replies
            </button>
          )}
        </div>
        <NoteContent event={event} className={expanded ? "mt-1" : "mt-1 line-clamp-3"} />
        {event.content.length > 280 && (
          <button className="link text-sm" onClick={onExpand}>
            {expanded ? "less" : "more"}
          </button>
        )}
        <Reactions event={event} />
      </div>
    </div>
  );
}

const MAX_REACTION_GROUPS = 12;

type ReactionGroup = { content: string; url?: string; count: number };

/** Groups reactions that target an event by emoji, most used first */
function groupReactions(reactions: Reaction[], eventId: string): ReactionGroup[] {
  const groups = new Map<string, ReactionGroup>();
  for (const reaction of reactions) {
    // Hell thread reactions tag the root too, only count the ones targeting this event
    if (reaction.eventPointer?.id !== eventId) continue;

    const group = groups.get(reaction.content);
    if (group) group.count++;
    else groups.set(reaction.content, { content: reaction.content, url: reaction.emoji?.url, count: 1 });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}

/** Reactions to a single thread event grouped by emoji */
function Reactions({ event }: { event: NostrEvent }) {
  const groups = use$(
    () =>
      eventStore.model(ReactionsModel, event).pipe(
        castTimelineStream(Reaction, eventStore),
        map((reactions) => groupReactions(reactions, event.id)),
        // Reactions are already stored, this only limits how often a busy row re-renders
        auditTime(250),
      ),
    [event],
  );

  if (!groups?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {groups.slice(0, MAX_REACTION_GROUPS).map((group) => (
        <span key={group.content} className="badge badge-outline max-w-40 gap-1 truncate" title={group.content}>
          {group.url ? <img src={group.url} alt={group.content} loading="lazy" className="h-4 w-4" /> : group.content}
          <span className="tabular-nums">{group.count}</span>
        </span>
      ))}
      {groups.length > MAX_REACTION_GROUPS && (
        <span className="badge badge-ghost">+{groups.length - MAX_REACTION_GROUPS} more</span>
      )}
    </div>
  );
}
