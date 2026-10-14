/**
 * Sync every event published by a user's contacts in a date range using NIP-77 negentropy and outbox relay selection
 * @tags nip-65, nip-77, outbox, negentropy, sync, chart.js, react-chartjs-2
 * @related outbox/social-feed, loader/sync-loader
 */
import { castUser } from "applesauce-common/casts";
import { defined, EventStore, filterOptimalRelays, includeMailboxes } from "applesauce-core";
import {
  createOutboxMap,
  fakeVerifyEvent,
  getDisplayName,
  getProfilePicture,
  NostrEvent,
  unixNow,
} from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, SyncRelayStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { ignoreUnhealthyRelaysOnPointers, RelayLiveness, RelayPool } from "applesauce-relay";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import localforage from "localforage";
import {
  Chart as ChartJS,
  ChartData,
  ChartOptions,
  Legend,
  LinearScale,
  LineElement,
  Plugin,
  PointElement,
  Tooltip,
} from "chart.js";
import { memo, ReactNode } from "react";
import { Line } from "react-chartjs-2";
import {
  auditTime,
  BehaviorSubject,
  combineLatest,
  debounceTime,
  defer,
  distinctUntilChanged,
  filter,
  finalize,
  interval,
  map,
  Observable,
  of,
  pairwise,
  ReplaySubject,
  scan,
  share,
  shareReplay,
  startWith,
  switchMap,
  take,
  takeWhile,
  timer,
  withLatestFrom,
} from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

const pool = new RelayPool({
  // Cache NIP-11 documents so NIP-77 support checks are instant on repeat runs
  informationCache: new Keyv({ store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "nip11" }) }),
});
const eventStore = new EventStore({ verifyEvent: fakeVerifyEvent });

// Load profiles, contact lists and relay lists on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Skip relays that have been failing
const liveness = new RelayLiveness({ storage: localforage.createInstance({ name: "liveness" }) });
await liveness.load();
liveness.connectToPool(pool);

// The sync loader uses NIP-77 when a relay supports it and falls back to paginated REQs
const syncLoader = createSyncLoader({ eventStore, pool });

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

const PRESETS = [
  { label: "1 hour", seconds: HOUR },
  { label: "24 hours", seconds: DAY },
  { label: "7 days", seconds: 7 * DAY },
  { label: "30 days", seconds: 30 * DAY },
  { label: "1 year", seconds: 365 * DAY },
];

type DateRange = { since: number; until: number };

/** Creates a fixed range that ends now */
const lastSeconds = (seconds: number): DateRange => ({ since: unixNow() - seconds, until: unixNow() });

// Settings that can change while the sync is running
const pubkey$ = new BehaviorSubject<string | null>(null);
const range$ = new BehaviorSubject<DateRange>(lastSeconds(DAY));
const maxConnections$ = new BehaviorSubject(30);
const maxRelaysPerUser$ = new BehaviorSubject(3);
const concurrency$ = new BehaviorSubject(10);
// The sync is done when fewer than this many new events arrive within the window
const cutoff$ = new BehaviorSubject({ events: 2, seconds: 5 });

// ---------- Concurrency limiter ----------

// The number of relays currently syncing
const active$ = new BehaviorSubject(0);

/** Waits for a free slot before subscribing to the work, so changing the concurrency applies to queued relays */
function withSlot<T>(work$: Observable<T>): Observable<T> {
  return combineLatest([concurrency$, active$]).pipe(
    // Read the current values since another relay may have taken the slot during this emission
    filter(() => active$.value < concurrency$.value),
    take(1),
    switchMap(() => {
      active$.next(active$.value + 1);
      return work$.pipe(finalize(() => active$.next(active$.value - 1)));
    }),
  );
}

// ---------- Outbox relay selection ----------

/** The contacts of the selected user with their NIP-65 outboxes */
const contacts$ = pubkey$.pipe(
  switchMap((pubkey) => (pubkey ? castUser(pubkey, eventStore).contacts$ : of(undefined))),
  defined(),
  map((users) => users.map((user) => user.pointer)),
  includeMailboxes(eventStore),
  ignoreUnhealthyRelaysOnPointers(liveness),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** The contacts with the optimal relays selected for them */
const selection$ = contacts$.pipe(
  // Mailboxes arrive one at a time, so wait for them to settle
  debounceTime(500),
  filterOptimalRelays(maxConnections$, maxRelaysPerUser$),
  shareReplay({ bufferSize: 1, refCount: true }),
);

// ---------- Sync tasks ----------

type TaskState = SyncRelayStatus["state"] | "queued" | "canceled";
type TaskStatus = Pick<Partial<SyncRelayStatus>, "method" | "negentropy" | "error"> & {
  state: TaskState;
  received: number;
};
type RelayTask = {
  relay: string;
  authors: string[];
  status$: Observable<TaskStatus & { started?: number; ended?: number }>;
};

/** Creates a shared sync of one relay for the authors that were assigned to it */
function createTask(relay: string, authors: string[], range: DateRange): RelayTask {
  const work$ = defer(() => {
    const started = Date.now();
    const { status$, events$ } = syncLoader({ relays: [relay], filter: { authors, ...range } });

    return combineLatest([
      status$.pipe(map((status) => Object.values(status.relays)[0])),
      // Status snapshots only emit on state changes, so count the events for a live total
      events$.pipe(
        scan((count) => count + 1, 0),
        startWith(0),
      ),
    ]).pipe(
      map(([status, received]) => ({
        state: status.state,
        method: status.method,
        negentropy: status.negentropy,
        error: status.error,
        received,
        started,
        ended: status.state === "complete" || status.state === "error" ? Date.now() : undefined,
      })),
    );
  });

  return {
    relay,
    authors,
    status$: withSlot(work$).pipe(
      startWith<TaskStatus>({ state: "queued", received: 0 }),
      share({
        connector: () => new ReplaySubject(1),
        // Keep finished results instead of re-running them
        resetOnComplete: false,
        resetOnError: false,
        // Survive the brief unsubscribe when the selection changes, cancel if the relay was dropped
        resetOnRefCountZero: () => timer(1000),
      }),
    ),
  };
}

/** A sync task per selected relay, reusing tasks whose relay, authors and range did not change */
const tasks$ = combineLatest([selection$.pipe(map(createOutboxMap)), range$]).pipe(
  scan((prev, [outboxMap, range]) => {
    const next = new Map<string, RelayTask>();
    for (const [relay, users] of Object.entries(outboxMap)) {
      const authors = users.map((user) => user.pubkey).sort();
      const key = [relay, range.since, range.until, authors.join()].join("|");
      next.set(key, prev.get(key) ?? createTask(relay, authors, range));
    }
    return next;
  }, new Map<string, RelayTask>()),
  map((tasks) => Array.from(tasks.values())),
  shareReplay({ bufferSize: 1, refCount: true }),
);

type TaskProgress = { task: RelayTask; status: TaskStatus & { started?: number; ended?: number } };

/** The live status of every sync task, subscribing runs the relay syncs */
const liveProgress$ = tasks$.pipe(
  switchMap((tasks) =>
    tasks.length === 0
      ? of<TaskProgress[]>([])
      : combineLatest(tasks.map((task) => task.status$.pipe(map((status) => ({ task, status }))))),
  ),
  // Every event updates a count, so limit re-renders
  auditTime(250),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** Whether each selected relay currently has an open connection */
const connections$ = tasks$.pipe(
  map((tasks) => Array.from(new Set(tasks.map((task) => task.relay)))),
  switchMap((relays) =>
    relays.length === 0 ? of([]) : combineLatest(relays.map((url) => pool.relay(url).connected$)),
  ),
  map((connected) => connected.filter(Boolean).length),
  auditTime(250),
);

// ---------- Live results from the store ----------

type Results = { total: number; kinds: Record<number, number>; recent: NostrEvent[] };
const EMPTY_RESULTS: Results = { total: 0, kinds: {}, recent: [] };

/** Counts every event in the store from the contacts in the range, as it arrives */
const results$ = combineLatest([
  // Only restart the count when the set of contacts changes, not when their mailboxes load
  contacts$.pipe(
    map((contacts) => contacts.map((c) => c.pubkey)),
    distinctUntilChanged((a, b) => a.join() === b.join()),
  ),
  range$,
]).pipe(
  switchMap(([authors, range]) =>
    eventStore.filters({ authors, ...range }).pipe(
      scan(
        (acc, event): Results => ({
          total: acc.total + 1,
          kinds: { ...acc.kinds, [event.kind]: (acc.kinds[event.kind] ?? 0) + 1 },
          recent: [event, ...acc.recent.slice(0, 29)],
        }),
        EMPTY_RESULTS,
      ),
      startWith(EMPTY_RESULTS),
    ),
  ),
  // The events are already in the store, so it is safe to throttle the UI
  auditTime(250),
  shareReplay({ bufferSize: 1, refCount: true }),
);

type SyncRun = {
  progress: TaskProgress[];
  done: boolean;
  at: number;
  // The unique event totals over the cutoff window
  totals: { time: number; total: number }[];
};

/** Marks the relays that had not finished as canceled */
const cancelUnfinished = (progress: TaskProgress[], at: number) =>
  progress.map((p) => (p.status.ended ? p : { ...p, status: { ...p.status, state: "canceled" as const, ended: at } }));

/**
 * Runs the sync until every relay finished or the unique event inflow drops below the cutoff. Completing unsubscribes
 * from the relays, so the last emission marks the unfinished relays as canceled
 */
const sync$ = combineLatest([pubkey$, range$, maxConnections$, maxRelaysPerUser$]).pipe(
  // Changing a setting starts a new run, finished relays are reused
  switchMap(() =>
    // Tick every second so the cutoff is checked even when no events arrive
    combineLatest([liveProgress$, results$, cutoff$, timer(0, 1000)]).pipe(
      scan(
        (run, [progress, results, cutoff]): SyncRun => {
          const now = Date.now();
          const window = cutoff.seconds * 1000;
          // Keep the totals in the window plus the one just before it
          const totals = [...run.totals, { time: now, total: results.total }];
          while (totals.length > 1 && totals[1].time <= now - window) totals.shift();

          const finished = progress.length > 0 && progress.every((p) => p.status.ended);
          // The outbox selection stays open and keeps adjusting, so a slow trickle of events also counts as done
          const quiet =
            progress.some((p) => p.status.started) &&
            totals[0].time <= now - window &&
            results.total - totals[0].total < cutoff.events;

          return { progress, totals, done: finished || quiet, at: now };
        },
        { progress: [], totals: [], done: false, at: 0 },
      ),
      // Complete once done, which cancels the relay syncs that are still running
      takeWhile((run) => !run.done, true),
      map((run) => (run.done ? { ...run, progress: cancelUnfinished(run.progress, run.at) } : run)),
    ),
  ),
  shareReplay({ bufferSize: 1, refCount: true }),
);

/** New events per second */
const rate$ = interval(1000).pipe(
  withLatestFrom(results$),
  map(([, results]) => results.total),
  pairwise(),
  map(([a, b]) => Math.max(0, b - a)),
  startWith(0),
);

type Sample = { time: number; unique: number; received: number; negentropy: number; request: number };

/** The times the outbox model selected a different set of relays */
const relaySetChanges$ = tasks$.pipe(
  map((tasks) =>
    tasks
      .map((task) => task.relay)
      .sort()
      .join(),
  ),
  distinctUntilChanged(),
  scan((times, _relays) => [...times, Date.now()], [] as number[]),
);

/** Samples the unique and received events per second and the active syncs while relays are syncing */
const history$ = combineLatest([pubkey$, range$]).pipe(
  // Start a new chart when the sync restarts
  switchMap(() =>
    combineLatest({
      samples: interval(1000).pipe(
        withLatestFrom(results$, sync$),
        // Stop sampling once the sync is done
        filter(([, , run]) => !run.done),
        scan(
          (acc, [, results, { progress }]) => {
            const unique = results.total;
            const received = progress.reduce((sum, p) => sum + p.status.received, 0);
            const sample: Sample = {
              time: Date.now(),
              // Inflow since the last sample, the first sample is the baseline. Restarted relays reset their
              // received count, so clamp drops to zero
              unique: acc.samples.length ? Math.max(0, unique - acc.unique) : 0,
              received: acc.samples.length ? Math.max(0, received - acc.received) : 0,
              // The relays currently downloading events with each method
              negentropy: progress.filter((p) => p.status.state === "loading" && p.status.method === "negentropy")
                .length,
              request: progress.filter((p) => p.status.state === "loading" && p.status.method === "request").length,
            };
            return { unique, received, samples: [...acc.samples, sample] };
          },
          { unique: 0, received: 0, samples: [] as Sample[] },
        ),
        map((acc) => acc.samples),
        startWith([] as Sample[]),
      ),
      changes: relaySetChanges$.pipe(startWith([] as number[])),
    }),
  ),
  shareReplay({ bufferSize: 1, refCount: true }),
);

// A shared clock for durations
const now$ = timer(0, 1000).pipe(
  map(() => Date.now()),
  shareReplay({ bufferSize: 1, refCount: true }),
);

// ---------- Formatting ----------

const KIND_NAMES: Record<number, string> = {
  0: "Profile",
  1: "Note",
  3: "Contacts",
  5: "Delete",
  6: "Repost",
  7: "Reaction",
  16: "Generic repost",
  1111: "Comment",
  1984: "Report",
  9735: "Zap",
  10002: "Relays",
  30023: "Article",
};

const kindName = (kind: number) => KIND_NAMES[kind] ?? `Kind ${kind}`;
const hostname = (url: string) => url.replace(/^wss?:\/\//, "").replace(/\/$/, "");
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Formats a duration in milliseconds as seconds or minutes */
function formatDuration(ms: number) {
  const seconds = Math.round(ms / 1000);
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/** Converts a unix timestamp to a datetime-local input value */
function toInputValue(unix: number) {
  const date = new Date(unix * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

const fromInputValue = (value: string) => (value ? Math.floor(new Date(value).getTime() / 1000) : undefined);

const STATE_ORDER: Record<TaskState, number> = {
  loading: 0,
  checking: 1,
  pending: 2,
  queued: 3,
  complete: 4,
  canceled: 5,
  error: 6,
};

const STATE_BADGE: Record<TaskState, string> = {
  queued: "badge-ghost",
  pending: "badge-ghost",
  checking: "badge-info",
  loading: "badge-primary",
  complete: "badge-success",
  canceled: "badge-warning",
  error: "badge-error",
};

// ---------- Components ----------

function DateRangePicker() {
  const range = use$(range$);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className={`btn btn-sm ${range.until - range.since === preset.seconds ? "btn-primary" : ""}`}
            onClick={() => range$.next(lastSeconds(preset.seconds))}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2">
        <span className="text-sm w-12">From</span>
        <input
          type="datetime-local"
          className="input input-sm flex-1"
          value={toInputValue(range.since)}
          onChange={(e) => {
            const since = fromInputValue(e.target.value);
            if (since !== undefined) range$.next({ ...range, since });
          }}
        />
      </label>
      <label className="flex items-center gap-2">
        <span className="text-sm w-12">To</span>
        <input
          type="datetime-local"
          className="input input-sm flex-1"
          value={toInputValue(range.until)}
          onChange={(e) => {
            const until = fromInputValue(e.target.value);
            if (until !== undefined) range$.next({ ...range, until });
          }}
        />
      </label>
      {range.until < range.since && <div className="text-sm text-error">The end date is before the start date</div>}
    </div>
  );
}

function Slider({
  label,
  value$,
  min,
  max,
  hint,
}: {
  label: string;
  value$: BehaviorSubject<number>;
  min: number;
  max: number;
  hint?: string;
}) {
  const value = use$(value$);
  return (
    <div>
      <label className="label w-full justify-between">
        <span className="label-text">{label}</span>
        <span className="label-text-alt">{value}</span>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => value$.next(Number(e.target.value))}
        className="range range-primary range-sm"
      />
      {hint && <div className="text-sm text-base-content/60 mt-1">{hint}</div>}
    </div>
  );
}

function CutoffInput() {
  const cutoff = use$(cutoff$);
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="label-text">Done below</span>
        <input
          type="number"
          min={1}
          className="input input-sm w-16"
          value={cutoff.events}
          onChange={(e) => cutoff$.next({ ...cutoff, events: Math.max(1, Number(e.target.value)) })}
        />
        <span>/</span>
        <input
          type="number"
          min={1}
          className="input input-sm w-16"
          value={cutoff.seconds}
          onChange={(e) => cutoff$.next({ ...cutoff, seconds: Math.max(1, Number(e.target.value)) })}
        />
        <span className="label-text">s</span>
      </div>
      <div className="text-sm text-base-content/60 mt-1">
        The sync is done when fewer new events than this arrive in the window.
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="border border-base-300 rounded px-3 py-2">
      <div className="text-sm text-base-content/60">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-sm text-base-content/60">{sub}</div>}
    </div>
  );
}

// Categorical colors in fixed order
const EVENT_SERIES = [
  { key: "unique", label: "Unique /s", color: "#2a78d6" },
  { key: "received", label: "Received /s", color: "#eb6834" },
] as const;
const SYNC_SERIES = [
  { key: "negentropy", label: "NIP-77 syncs", color: "#1baf7a" },
  { key: "request", label: "REQs", color: "#eda100" },
] as const;

const MARKER_COLOR = "rgba(128, 128, 128, 0.6)";

declare module "chart.js" {
  interface PluginOptionsByType<TType> {
    relaySet?: { times: number[] };
  }
}

/** Draws a dashed vertical line at each time the relay set changed */
const relaySetPlugin: Plugin<"line"> = {
  id: "relaySet",
  afterDatasetsDraw(chart, _args, options: { times?: number[] }) {
    const { ctx, chartArea, scales } = chart;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = MARKER_COLOR;
    for (const time of options.times ?? []) {
      const x = Math.min(Math.max(scales.x.getPixelForValue(time), chartArea.left), chartArea.right);
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
};

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, relaySetPlugin);

/** A line chart of sampled values over time, with the relay set changes marked */
function TimeChart({
  title,
  series,
  samples,
  changes,
  showTime,
  children,
}: {
  title: string;
  series: readonly { key: Exclude<keyof Sample, "time">; label: string; color: string }[];
  samples: Sample[];
  changes: number[];
  showTime?: boolean;
  children?: ReactNode;
}) {
  const start = samples[0].time;
  const seconds = (time: number) => (time - start) / 1000;

  const data: ChartData<"line"> = {
    datasets: series.map(({ key, label, color }) => ({
      label,
      data: samples.map((s) => ({ x: seconds(s.time), y: s[key] })),
      borderColor: color,
      backgroundColor: color,
    })),
  };

  const options: ChartOptions<"line"> = {
    animation: false,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    elements: { point: { radius: 0, hoverRadius: 4 }, line: { borderWidth: 2 } },
    scales: {
      // Both charts share the same time range, only the bottom one labels it
      x: {
        type: "linear",
        min: 0,
        max: seconds(samples[samples.length - 1].time),
        ticks: { display: !!showTime, callback: (value) => formatDuration(Number(value) * 1000) },
      },
      // A fixed axis width keeps the two charts' plot areas aligned
      y: { beginAtZero: true, ticks: { precision: 0 }, afterFit: (axis) => void (axis.width = 48) },
    },
    plugins: {
      legend: {
        position: "right",
        // A fixed legend width keeps the plot areas aligned on the right too
        maxWidth: 140,
        labels: { usePointStyle: true, pointStyle: "line", boxWidth: 12 },
      },
      tooltip: { callbacks: { title: (items) => `at ${formatDuration((items[0].parsed.x ?? 0) * 1000)}` } },
      relaySet: { times: changes.map(seconds) },
    },
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <div className="flex items-center gap-2 text-sm">
        <h4 className="font-semibold">{title}</h4>
        {children}
      </div>
      <div className="relative min-h-0 flex-1">
        <Line data={data} options={options} />
      </div>
    </div>
  );
}

/** Separate charts for event inflow and active syncs, since they are measured on different scales */
function SyncChart() {
  const { samples, changes } = use$(history$) ?? { samples: [], changes: [] };

  return (
    // Positioned contents so the charts fill the height of the stats grid instead of setting it
    <div className="relative flex-1 min-w-96 min-h-56 border border-base-300 rounded">
      <div className="absolute inset-0 flex flex-col divide-y divide-base-300">
        {samples.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-base-content/60">
            Waiting for events...
          </div>
        ) : (
          <>
            <TimeChart title="Event inflow" series={EVENT_SERIES} samples={samples} changes={changes}>
              {/* Key for the relay set markers drawn on both charts */}
              <span className="ms-auto flex items-center gap-1 text-base-content/60">
                <span className="h-3 border-l border-dashed" style={{ borderColor: MARKER_COLOR }} />
                Relay set changed ({changes.length})
              </span>
            </TimeChart>
            <TimeChart title="Active relay syncs" series={SYNC_SERIES} samples={samples} changes={changes} showTime />
          </>
        )}
      </div>
    </div>
  );
}

function StatsBar({ progress }: { progress: TaskProgress[] }) {
  const results = use$(results$) ?? EMPTY_RESULTS;
  const rate = use$(rate$) ?? 0;
  const connected = use$(connections$) ?? 0;
  const active = use$(active$);
  const now = use$(now$) ?? Date.now();

  const count = (state: TaskState) => progress.filter((p) => p.status.state === state).length;
  const finished = count("complete") + count("error");
  const negentropy = progress.filter((p) => p.status.method === "negentropy").length;
  const request = progress.filter((p) => p.status.method === "request").length;
  const received = progress.reduce((sum, p) => sum + p.status.received, 0);

  // Measure from the first relay that started to when the sync was considered done
  const { done, at } = use$(sync$) ?? { done: false, at: now };
  const starts = progress.flatMap((p) => (p.status.started ? [p.status.started] : []));
  const elapsed = starts.length ? Math.max(0, (done ? at : now) - Math.min(...starts)) : 0;

  return (
    <div className="flex flex-wrap gap-2 p-2 border-b border-base-300">
      <div className="grid grid-cols-3 gap-2 shrink-0">
        <Stat label="Unique events" value={results.total.toLocaleString()} sub={`${rate.toLocaleString()}/s`} />
        <Stat
          label="Received"
          value={received.toLocaleString()}
          sub={results.total ? `${(received / results.total).toFixed(2)}× duplication` : "—"}
        />
        <Stat
          label="Relays"
          value={`${finished}/${progress.length}`}
          sub={done ? `${count("canceled")} canceled` : `${active} syncing · ${count("queued")} queued`}
        />
        <Stat label="Methods" value={`${negentropy} / ${request}`} sub="NIP-77 / REQ" />
        <Stat label="Connected" value={connected} sub={`${count("error")} errors`} />
        <Stat
          label="Elapsed"
          value={formatDuration(elapsed)}
          sub={done ? "complete" : progress.length ? "running" : "idle"}
        />
      </div>
      <SyncChart />
    </div>
  );
}

/** Compares finished relays by the method they synced with */
function MethodComparison({ progress }: { progress: TaskProgress[] }) {
  const rows = (["negentropy", "request"] as const).map((method) => {
    const relays = progress.filter(
      (p) => p.status.method === method && (p.status.state === "complete" || p.status.state === "error"),
    );
    const events = relays.reduce((sum, p) => sum + p.status.received, 0);
    const authors = relays.reduce((sum, p) => sum + p.task.authors.length, 0);
    const durations = relays.map((p) => p.status.ended! - p.status.started!).sort((a, b) => a - b);
    const seconds = durations.reduce((sum, d) => sum + d, 0) / 1000;

    return {
      method,
      relays: relays.length,
      errors: relays.filter((p) => p.status.state === "error").length,
      events,
      median: durations.length ? durations[Math.floor(durations.length / 2)] : 0,
      rate: seconds ? Math.round(events / seconds) : 0,
      perAuthor: authors ? (events / authors).toFixed(1) : "—",
    };
  });

  // Relays that advertise NIP-77 but had to fall back to paginated requests
  const fallbacks = progress.filter((p) => p.status.negentropy && p.status.method === "request").length;

  return (
    <div className="border-b border-base-300">
      <table className="table table-sm">
        <thead>
          <tr>
            <th>Method</th>
            <th className="text-right">Finished</th>
            <th className="text-right">Errors</th>
            <th className="text-right">Events</th>
            <th className="text-right">Per author</th>
            <th className="text-right">Median time</th>
            <th className="text-right">Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.method}>
              <td>{row.method === "negentropy" ? "NIP-77" : "REQ"}</td>
              <td className="text-right tabular-nums">{row.relays}</td>
              <td className="text-right tabular-nums">{row.errors}</td>
              <td className="text-right tabular-nums">{row.events.toLocaleString()}</td>
              <td className="text-right tabular-nums">{row.perAuthor}</td>
              <td className="text-right tabular-nums">{row.median ? formatDuration(row.median) : "—"}</td>
              <td className="text-right tabular-nums">{row.rate ? `${row.rate}/s` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="text-sm text-base-content/60 px-3 pb-2">
        NIP-77 only downloads events missing from the store, REQ downloads everything.{" "}
        {fallbacks > 0 && `${fallbacks} NIP-77 relays fell back to REQ.`}
      </div>
    </div>
  );
}

function RelayRow({ task, status, now }: TaskProgress & { now: number }) {
  const relay = pool.relay(task.relay);
  const icon = use$(relay.icon$);
  const connected = use$(relay.connected$);

  const duration = status.started ? (status.ended ?? now) - status.started : 0;
  const rate = duration > 1000 ? Math.round(status.received / (duration / 1000)) : 0;

  return (
    <tr>
      <td>
        <div className="flex items-center gap-2" title={task.relay}>
          <div className={`status ${connected ? "status-success" : "status-neutral"}`} />
          <img src={icon} className="w-5 h-5 rounded-full object-cover" />
          <span className="truncate max-w-48">{hostname(task.relay)}</span>
        </div>
      </td>
      <td>
        <span className={`badge ${STATE_BADGE[status.state]}`} title={status.error?.message}>
          {status.state}
        </span>
      </td>
      <td>{status.method === "negentropy" ? "NIP-77" : status.method === "request" ? "REQ" : "—"}</td>
      <td className="text-right tabular-nums">{task.authors.length}</td>
      <td className="text-right tabular-nums">{status.received.toLocaleString()}</td>
      <td className="text-right tabular-nums">{duration ? formatDuration(duration) : "—"}</td>
      <td className="text-right tabular-nums">{rate ? `${rate}/s` : "—"}</td>
    </tr>
  );
}

function RelayTable({ progress }: { progress: TaskProgress[] }) {
  const now = use$(now$) ?? Date.now();
  const sorted = [...progress].sort(
    (a, b) => STATE_ORDER[a.status.state] - STATE_ORDER[b.status.state] || b.status.received - a.status.received,
  );

  return (
    <table className="table table-sm">
      <thead className="sticky top-0 bg-base-100">
        <tr>
          <th>Relay</th>
          <th>State</th>
          <th>Method</th>
          <th className="text-right">Authors</th>
          <th className="text-right">Events</th>
          <th className="text-right">Time</th>
          <th className="text-right">Rate</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <RelayRow key={p.task.relay} {...p} now={now} />
        ))}
      </tbody>
    </table>
  );
}

// Memoized so only new events render as they arrive
const EventRow = memo(function EventRow({ event }: { event: NostrEvent }) {
  const profile = use$(() => castUser(event.pubkey, eventStore).profile$, [event.pubkey]);
  const name = getDisplayName(profile, event.pubkey.slice(0, 8));
  const picture = getProfilePicture(profile, `https://robohash.org/${event.pubkey}.png`);

  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-base-300">
      <img src={picture} className="w-8 h-8 rounded-full object-cover shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm truncate">{name}</span>
          <span className="text-sm text-base-content/60">{kindName(event.kind)}</span>
          <span className="text-sm text-base-content/60 ms-auto shrink-0">
            {dateFormat.format(event.created_at * 1000)}
          </span>
        </div>
        {event.content && <div className="text-sm truncate text-base-content/80">{event.content.slice(0, 200)}</div>}
      </div>
    </div>
  );
});

function ResultsPanel() {
  const results = use$(results$) ?? EMPTY_RESULTS;
  const kinds = Object.entries(results.kinds).sort(([, a], [, b]) => b - a);

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="grid grid-cols-2 gap-x-6 px-3 py-2 border-b border-base-300 text-sm text-base-content/70">
        {kinds.length === 0 && <span className="text-base-content/60">No events yet</span>}
        {kinds.slice(0, 8).map(([kind, count]) => (
          <div key={kind} className="flex justify-between">
            <span>{kindName(Number(kind))}</span>
            <span className="tabular-nums">{count.toLocaleString()}</span>
          </div>
        ))}
        {kinds.length > 8 && <span className="text-base-content/50">+{kinds.length - 8} more kinds</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {results.recent.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
    </div>
  );
}

function SelectionSummary() {
  const contacts = use$(contacts$);
  const selection = use$(selection$);

  if (!contacts || !selection) return null;

  const withOutboxes = contacts.filter((c) => c.relays && c.relays.length > 0).length;
  const covered = selection.filter((c) => c.relays && c.relays.length > 0).length;

  return (
    <div className="text-sm flex flex-col gap-1">
      <div>{contacts.length} contacts</div>
      <div className={withOutboxes < contacts.length ? "text-warning" : ""}>
        {contacts.length - withOutboxes} without a NIP-65 relay list
      </div>
      <div className={covered < withOutboxes ? "text-error" : ""}>
        {withOutboxes - covered} dropped by relay selection
      </div>
    </div>
  );
}

export default function ContactsSyncExample() {
  const pubkey = use$(pubkey$);
  const progress = use$(sync$)?.progress;

  return (
    <div className="flex min-h-0 grow">
      <div className="flex flex-1 min-w-0 flex-col">
        <StatsBar progress={progress ?? []} />

        {!pubkey ? (
          <div className="text-center py-20 text-base-content/60">
            Pick a pubkey to sync every event from their contacts
          </div>
        ) : !progress || progress.length === 0 ? (
          <div className="flex justify-center items-center gap-2 py-20 text-base-content/60">
            <span className="loading loading-spinner" /> Loading contacts and relay lists...
          </div>
        ) : (
          <div className="flex min-h-0 flex-1">
            <div className="min-h-0 flex-1 overflow-y-auto border-r border-base-300">
              <MethodComparison progress={progress} />
              <RelayTable progress={progress} />
            </div>
            <div className="flex min-h-0 w-96 shrink-0 flex-col">
              <ResultsPanel />
            </div>
          </div>
        )}
      </div>

      <div className="w-80 shrink-0 border-l border-base-300 flex flex-col gap-4 p-4 overflow-y-auto">
        <div>
          <h3 className="font-semibold mb-2">Pubkey</h3>
          <PubkeyPicker value={pubkey ?? ""} onChange={(p) => pubkey$.next(p)} />
        </div>

        <div>
          <h3 className="font-semibold mb-2">Date range</h3>
          <DateRangePicker />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Relay selection</h3>
          <Slider label="Max connections" value$={maxConnections$} min={1} max={200} />
          <Slider label="Max relays per user" value$={maxRelaysPerUser$} min={1} max={10} />
          <SelectionSummary />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Sync</h3>
          <Slider
            label="Concurrent relays"
            value$={concurrency$}
            min={0}
            max={50}
            hint="Applies to queued relays. Set to 0 to hold the queue."
          />
          <CutoffInput />
        </div>
      </div>
    </div>
  );
}
