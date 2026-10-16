/**
 * Crawl a user's follow graph out to several hops to stress test the social graph loader's speed and completeness
 * @tags loader, social-graph, follows, stress
 * @related social-graph/nostr-social-graph, loader/timeline-scrubber
 */
import { EventStore } from "applesauce-core";
import { Filter, isFromCache, mergeRelaySets, NostrEvent, unixNow } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSocialGraphLoader } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { addEvents, clearDB, getEventsForFilters, openDB } from "nostr-idb";
import { useCallback, useState } from "react";
import {
  BehaviorSubject,
  bufferTime,
  catchError,
  concatMap,
  defer,
  EMPTY,
  filter,
  identity,
  ignoreElements,
  of,
} from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import {
  CrawlSnapshot,
  GraphMonitor,
  relayLoad,
  ReqRecord,
  verifyMissing,
  VerifyResult,
} from "../../helpers/social-graph-stress";
import { lookupRelays$ } from "../../settings";

// Users with large follow lists, any other user can be picked below
const PRESETS = [
  { name: "ODELL", pubkey: "04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9" },
  { name: "Derek Ross", pubkey: "3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24" },
  { name: "Gigi", pubkey: "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93" },
  { name: "fiatjaf", pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" },
  { name: "jb55", pubkey: "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245" },
  { name: "hzrd149", pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5" },
];
const DAY = 24 * 60 * 60;
const SINCE = [
  ["any time", 0],
  ["1 week", 7 * DAY],
  ["1 month", 30 * DAY],
  ["1 year", 365 * DAY],
] as const;

// Only used to look up NIP-65 outboxes when verifying missing users
const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// A dedicated IndexedDB cache for follow lists. The low level API keeps nothing in memory and never prunes
const db = await openDB("social-graph-stress");
const cacheRequest = (filters: Filter[]) => getEventsForFilters<NostrEvent>(db, filters);

// Records every REQ the loader sends and checks its output
const monitor = new GraphMonitor();
const request = monitor.instrument((relays, filters) => pool.request(relays, filters));

type RunConfig = {
  pubkey: string;
  distance: number;
  relays: string[];
  since?: number;
  parallel: number;
  concurrency: number;
  perRelay: number;
  hints: boolean;
  cache: boolean;
};
type RunRecord = { config: RunConfig; result: CrawlSnapshot };

// Finished and stopped runs, kept for comparing cold and warm runs side by side
const history$ = new BehaviorSubject<RunRecord[]>([]);

/** Runs one crawl and records it in the history when it ends */
function crawl(config: RunConfig) {
  return defer(() => {
    // The loader is created per run because its options are controls. It gets no event store, the example only
    // keeps the follows of each user so distance 2 crawls don't hold tens of thousands of full events
    const loader = createSocialGraphLoader(request, {
      cacheRequest: config.cache ? cacheRequest : undefined,
      parallel: config.parallel,
      concurrency: config.concurrency,
      maxRequestsPerRelay: config.perRelay,
      hints: config.hints,
    });
    const result = loader({
      pubkey: config.pubkey,
      relays: config.relays,
      distance: config.distance,
      since: config.since,
    });

    return monitor
      .track(result, config.pubkey, config.distance, (snapshot) =>
        history$.next([...history$.value, { config, result: snapshot }]),
      )
      .pipe(
        // Write new lists to the cache in chunks so a warm run can start from them
        config.cache
          ? (events$) =>
              events$.pipe(
                filter((event) => !isFromCache(event)),
                bufferTime(1000),
                filter((events) => events.length > 0),
                concatMap((events) => addEvents(db, events)),
              )
          : identity,
        ignoreElements(),
        catchError((error: Error) => of(error)),
      );
  });
}

const short = (relay: string) => relay.replace(/^wss:\/\//, "").replace(/\/$/, "");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const percent = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const presetName = (pubkey: string) => PRESETS.find((p) => p.pubkey === pubkey)?.name ?? pubkey.slice(0, 8);

export default function SocialGraphStress() {
  const [pubkey, setPubkey] = useState(PRESETS[0].pubkey);
  const [distance, setDistance] = useState(1);
  const [relayText, setRelayText] = useState(lookupRelays$.value.join("\n"));
  const [since, setSince] = useState(0);
  const [parallel, setParallel] = useState(100);
  const [concurrency, setConcurrency] = useState(6);
  const [perRelay, setPerRelay] = useState(4);
  const [hints, setHints] = useState(false);
  const [cache, setCache] = useState(true);
  const [run, setRun] = useState<RunConfig | null>(null);
  const [verify, setVerify] = useState<{ missing: string[]; relays: string[]; since?: number }>();
  const [clearing, setClearing] = useState(false);

  const pick = useCallback((pk: string) => pk && setPubkey(pk), []);

  const start = () => {
    setVerify(undefined);
    setRun({
      pubkey,
      distance,
      relays: mergeRelaySets(relayText.split(/\s+/)),
      since: since ? unixNow() - since : undefined,
      parallel,
      concurrency,
      perRelay,
      hints,
      cache,
    });
  };
  const clearCache = async () => {
    setClearing(true);
    await clearDB(db);
    setClearing(false);
  };

  const error = use$(() => (run ? crawl(run) : EMPTY), [run]);
  const stats = use$(monitor.snapshot$);
  const history = use$(history$);
  const verified = use$(
    () =>
      verify
        ? verifyMissing((r, f) => pool.request(r, f), eventStore, verify.missing, verify.relays, verify.since)
        : of(undefined),
    [verify],
  );

  const status = stats?.status;
  const running = !!run && !stats?.ended;
  const elapsed = stats ? (stats.ended ?? Date.now()) - stats.started : 0;

  return (
    <div className="flex min-h-0 grow flex-col gap-3 p-4 overflow-y-auto">
      <div className="flex flex-wrap items-start gap-2">
        <select
          className="select w-48"
          value={PRESETS.some((p) => p.pubkey === pubkey) ? pubkey : ""}
          onChange={(e) => pick(e.target.value)}
          aria-label="Preset user"
        >
          <option value="" disabled>
            Custom
          </option>
          {PRESETS.map((p) => (
            <option key={p.pubkey} value={p.pubkey}>
              {p.name}
            </option>
          ))}
        </select>
        <PubkeyPicker value={pubkey} onChange={pick} className="flex-1" />
      </div>

      <div className="flex flex-wrap items-start gap-2">
        <textarea
          className="textarea w-80 font-mono"
          rows={3}
          value={relayText}
          onChange={(e) => setRelayText(e.target.value)}
          aria-label="Relays to crawl"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select label="distance" value={distance} options={[1, 2, 3]} onChange={setDistance} />
          <Select label="batch" value={parallel} options={[20, 100, 300]} onChange={setParallel} />
          <Select label="batches" value={concurrency} options={[1, 3, 6, 12]} onChange={setConcurrency} />
          <Select label="per relay" value={perRelay} options={[1, 2, 4, 8]} onChange={setPerRelay} />
          <select
            className="select w-40"
            value={since}
            onChange={(e) => setSince(Number(e.target.value))}
            aria-label="Since"
          >
            {SINCE.map(([label, value]) => (
              <option key={label} value={value}>
                since {label}
              </option>
            ))}
          </select>
          <label className="label gap-2">
            <input type="checkbox" className="toggle" checked={hints} onChange={(e) => setHints(e.target.checked)} />
            Relay hints
          </label>
          <label className="label gap-2">
            <input type="checkbox" className="toggle" checked={cache} onChange={(e) => setCache(e.target.checked)} />
            Use cache
          </label>
          {running ? (
            <button className="btn btn-outline" onClick={() => setRun(null)}>
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={start}>
              Start
            </button>
          )}
          <button className="btn btn-outline" onClick={clearCache} disabled={clearing || running}>
            Clear cache
          </button>
        </div>
      </div>

      {error && <div className="border border-error p-2 text-error">{error.message}</div>}

      {stats?.status && <Stats stats={stats} elapsed={elapsed} running={running} />}
      {stats && stats.samples.length > 1 && <ProgressCurve stats={stats} />}

      {stats && stats.requests.length > 0 && <RelayActivity stats={stats} limit={run?.perRelay ?? perRelay} />}

      <section className="flex flex-col border border-base-300">
        <div className="flex flex-wrap items-center gap-3 border-b border-base-300 px-2 py-1">
          <h2 className="font-semibold">Verify missing</h2>
          <button
            className="btn btn-sm btn-outline"
            disabled={!status?.done || status.missing === 0}
            onClick={() => run && setVerify({ missing: monitor.missing(), relays: run.relays, since: run.since })}
          >
            Check 50 missing users
          </button>
        </div>
        <VerifyPanel result={verified} />
      </section>

      <RunHistory history={history ?? []} />
    </div>
  );
}

function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number;
  options: number[];
  onChange: (value: number) => void;
}) {
  return (
    <select className="select w-36" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {options.map((n) => (
        <option key={n} value={n}>
          {label} {n}
        </option>
      ))}
    </select>
  );
}

/** Totals for the current crawl and any failed consistency checks */
function Stats({ stats, elapsed, running }: { stats: CrawlSnapshot; elapsed: number; running: boolean }) {
  const { status, checks, requests } = stats;
  const active = requests.filter((r) => r.state === "active").length;
  const retries = requests.filter((r) => r.kind === "retry").length;
  const errors = requests.filter((r) => r.state === "error").length;
  const gap = stats.expected !== undefined && status ? stats.expected - status.requested : 0;
  const failed = [
    checks.stale && `${checks.stale} stale lists emitted`,
    checks.afterDone && `${checks.afterDone} emissions after done`,
    status?.done && checks.doneCount !== 1 && `done emitted ${checks.doneCount} times`,
    checks.openAfterEnd && `${checks.openAfterEnd} REQs left open`,
    checks.foundMismatch && `found is off by ${checks.foundMismatch}`,
    checks.requestedMismatch && `requested is off by ${checks.requestedMismatch} from the REQs sent`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-1 border-y border-base-300 py-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        <span>
          Time <strong>{seconds(elapsed)}</strong>
        </span>
        <span>
          Found <strong>{status?.found ?? 0}</strong> / {status?.requested ?? 0} (
          {percent(status?.found ?? 0, status?.requested ?? 0)})
        </span>
        <span>
          Missing <strong>{status?.missing ?? 0}</strong>
        </span>
        <span>
          Queued <strong>{status?.queued ?? 0}</strong>
        </span>
        <span>
          Batches <strong>{status?.inFlight ?? 0}</strong>
        </span>
        <span>
          Lists/s <strong>{elapsed > 0 ? ((stats.lists / elapsed) * 1000).toFixed(0) : 0}</strong>
        </span>
        <span>
          From cache <strong>{stats.cached}</strong>
        </span>
        <span>
          Follow edges <strong>{stats.edges.toLocaleString()}</strong>
        </span>
        <span>
          REQs <strong>{active}</strong> / {requests.length}
        </span>
        <span>
          Retries <strong>{retries}</strong>
        </span>
        <span className={errors ? "text-error" : ""}>
          Errors <strong>{errors}</strong>
        </span>
        {status?.done && <span className="badge badge-success">Done</span>}
        {!status?.done && !running && <span className="badge badge-warning">Stopped</span>}
      </div>
      {failed.map((message) => (
        <div key={String(message)} className="text-error">
          Check failed: {message}
        </div>
      ))}
      {gap > 0 && (
        <div className="text-warning">
          A strict breadth-first crawl would request {gap} more users. Batches finish out of order, so some users are
          first seen further from the root than they are and never expanded
        </div>
      )}
    </div>
  );
}

/** Found and requested users over time */
function ProgressCurve({ stats }: { stats: CrawlSnapshot }) {
  const samples = stats.samples;
  const maxT = Math.max(samples[samples.length - 1].t, 1);
  const maxN = Math.max(...samples.map((s) => s.requested), 1);
  const line = (key: "found" | "requested") =>
    samples.map((s) => `${(s.t / maxT) * 1000},${200 - (s[key] / maxN) * 200}`).join(" ");

  return (
    <section className="border border-base-300">
      <h2 className="flex gap-4 border-b border-base-300 px-2 py-1">
        <span className="font-semibold">Progress</span>
        <span className="text-base-content/60">requested</span>
        <span className="text-success">found</span>
        <span className="ms-auto">
          {maxN.toLocaleString()} users · {seconds(maxT)}
        </span>
      </h2>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="h-40 w-full">
        <polyline
          points={line("requested")}
          fill="none"
          className="stroke-base-content/40"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <polyline
          points={line("found")}
          fill="none"
          className="stroke-success"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </section>
  );
}

const KINDS = [
  ["batch", "fill-primary", "batch, one filter for up to 100 users"],
  ["retry", "fill-warning", "retry, one filter per user a lossy relay dropped"],
  ["refresh", "fill-info", "refresh, cached users asked for newer lists"],
] as const;
const kindFill = (r: ReqRecord) =>
  r.state === "error"
    ? "fill-error"
    : r.state === "cancelled"
      ? "fill-base-content/30"
      : KINDS.find(([kind]) => kind === r.kind)![1];
// Height of one REQ row in a relay lane
const ROW = 10;

/** Per relay load and a timeline of every REQ, stacked so each lane's height is the relay's peak concurrency */
function RelayActivity({ stats, limit }: { stats: CrawlSnapshot; limit: number }) {
  const now = stats.ended ?? Date.now();
  const total = Math.max(now - stats.started, 1);
  const loads = relayLoad(stats.requests, now);
  const x = (t: number) => ((t - stats.started) / total) * 1000;

  return (
    <section className="flex flex-col border border-base-300">
      <h2 className="flex flex-wrap gap-x-4 border-b border-base-300 px-2 py-1">
        <span className="font-semibold">Relay activity</span>
        {KINDS.map(([kind, fill, label]) => (
          <span key={kind} className="flex items-center gap-1" title={label}>
            <svg className="size-3">
              <rect width="100%" height="100%" className={fill} />
            </svg>
            {kind}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <svg className="size-3">
            <rect width="100%" height="100%" className="fill-error" />
          </svg>
          error
        </span>
        <span className="flex items-center gap-1">
          <svg className="size-3">
            <rect width="100%" height="100%" className="fill-base-content/30" />
          </svg>
          cancelled
        </span>
        <span className="ms-auto">0s – {seconds(total)}</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Relay</th>
              <th title="Most REQs open at once, against the per relay limit">Peak open</th>
              <th title="Most REQs started in any one second">Peak REQ/s</th>
              <th>REQs</th>
              <th title="Users asked for per REQ, on average">Users / REQ</th>
              <th>Events</th>
              <th>Retries</th>
              <th>Errors</th>
              <th>Avg</th>
              <th>Max</th>
            </tr>
          </thead>
          <tbody>
            {loads.map((load) => {
              const status = stats.status?.relays[load.relay];
              const times = load.requests.filter((r) => r.end).map((r) => r.end! - r.start);
              return (
                <tr key={load.relay}>
                  <td title={load.relay}>{short(load.relay)}</td>
                  <td className={load.peakOpen > limit ? "text-error" : ""}>
                    {load.peakOpen} / {limit}
                  </td>
                  <td>{load.peakRate}</td>
                  <td>{load.requests.length}</td>
                  <td>{(load.authors / load.requests.length).toFixed(0)}</td>
                  <td>{status?.events ?? 0}</td>
                  <td>{status?.retries ?? 0}</td>
                  <td className={status?.errors ? "text-error" : ""} title={status?.error?.message}>
                    {status?.errors ?? 0}
                  </td>
                  <td>{times.length ? seconds(times.reduce((a, b) => a + b, 0) / times.length) : "—"}</td>
                  <td>{times.length ? seconds(Math.max(...times)) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {loads.map((load) => (
        <div key={load.relay} className="border-t border-base-300 px-2 py-1">
          <div className="text-sm">{short(load.relay)}</div>
          <svg
            viewBox={`0 0 1000 ${load.peakOpen * ROW}`}
            preserveAspectRatio="none"
            className="w-full"
            style={{ height: load.peakOpen * ROW }}
          >
            {load.requests.map((r) => (
              <rect
                key={r.id}
                x={x(r.start)}
                y={r.slot * ROW + 1}
                width={Math.max(x(r.end ?? now) - x(r.start), 1)}
                height={ROW - 2}
                className={kindFill(r)}
              >
                <title>
                  {r.kind} · {r.authors} users in {r.filters} filters → {r.events} events · {r.state} ·{" "}
                  {seconds((r.end ?? now) - r.start)}
                  {r.error && ` · ${r.error}`}
                </title>
              </rect>
            ))}
          </svg>
        </div>
      ))}
    </section>
  );
}

/** Where a sample of missing users' follow lists turned up, if anywhere */
function VerifyPanel({ result }: { result?: VerifyResult }) {
  if (!result)
    return (
      <p className="p-2 text-sm">
        After a crawl, re-ask the crawl relays and each user's NIP-65 outboxes for a sample of the users without a list,
        one filter per user.
      </p>
    );

  const buckets = [
    ["Lost by the loader (on the crawl relays)", result.onCrawlRelays, "text-error"],
    ["Only on the user's outboxes", result.onOutboxes, ""],
    ["No list anywhere checked", result.none, ""],
  ] as const;

  return (
    <div className="flex flex-col gap-1 p-2">
      <div>
        Checked <strong>{result.checked.length}</strong> users {result.state !== "done" && `· asking ${result.state}…`}
      </div>
      {result.state === "done" &&
        buckets.map(([label, pubkeys, color]) => (
          <details key={label} className={pubkeys.length ? color : ""}>
            <summary>
              {label}: <strong>{pubkeys.length}</strong>
            </summary>
            <ul className="font-mono text-sm">
              {pubkeys.map((pubkey) => (
                <li key={pubkey}>{pubkey}</li>
              ))}
            </ul>
          </details>
        ))}
    </div>
  );
}

/** Finished and stopped runs */
function RunHistory({ history }: { history: RunRecord[] }) {
  if (history.length === 0) return null;

  return (
    <section className="flex flex-col border border-base-300">
      <h2 className="border-b border-base-300 px-2 py-1 font-semibold">Runs</h2>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>User</th>
              <th>Distance</th>
              <th>Options</th>
              <th>Time</th>
              <th>Found</th>
              <th>Cached</th>
              <th>REQs</th>
              <th>Retries</th>
              <th>Errors</th>
              <th>Checks</th>
            </tr>
          </thead>
          <tbody>
            {history.map(({ config, result }, i) => {
              const { status, checks, requests } = result;
              const failures =
                checks.stale +
                checks.afterDone +
                (checks.openAfterEnd ?? 0) +
                Math.abs(checks.foundMismatch ?? 0) +
                Math.abs(checks.requestedMismatch ?? 0) +
                (status?.done && checks.doneCount !== 1 ? 1 : 0);
              return (
                <tr key={i}>
                  <td>{presetName(config.pubkey)}</td>
                  <td>{config.distance}</td>
                  <td>
                    {config.parallel}×{config.concurrency}, {config.perRelay}/relay
                    {config.hints && ", hints"}
                    {config.cache && ", cache"}
                    {config.since && ", since"}
                  </td>
                  <td>{seconds((result.ended ?? result.started) - result.started)}</td>
                  <td>
                    {status?.found ?? 0} / {status?.requested ?? 0} (
                    {percent(status?.found ?? 0, status?.requested ?? 0)}){!status?.done && " stopped"}
                  </td>
                  <td>{result.cached}</td>
                  <td>{requests.length}</td>
                  <td>{requests.filter((r) => r.kind === "retry").length}</td>
                  <td>{requests.filter((r) => r.state === "error").length}</td>
                  <td className={failures ? "text-error" : "text-success"}>{failures ? "failed" : "ok"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
