/**
 * Sync the NIP-66 relay reports of a few monitors with the sync loader, then filter and sort the relays by any attribute to discover new ones
 * @tags nip-66, nip-77, relay-discovery, sync, negentropy, loader, stress
 * @related relay-discovery/monitor-feed, relay-discovery/attributes, loader/sync-loader
 */
import { RelayDiscovery, RelayMonitor } from "applesauce-common/casts";
import { RELAY_DISCOVERY_KIND, RELAY_MONITOR_ANNOUNCEMENT_KIND } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { castUser, defined, EventStore, mapEventsToStore } from "applesauce-core";
import { getDisplayName, mergeRelaySets, unixNow } from "applesauce-core/helpers";
import {
  createEventLoaderForStore,
  createSyncLoader,
  type SyncLoaderStatus,
  type SyncRelayStatus,
} from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useState } from "react";
import {
  catchError,
  combineLatest,
  defer,
  EMPTY,
  ignoreElements,
  map,
  merge,
  type Observable,
  of,
  take,
  throttleTime,
  timeout,
} from "rxjs";

import {
  aggregateRelays,
  compareRelays,
  countFacet,
  type Facet,
  facetLabel,
  type FacetFilters,
  FACETS,
  matchesFacets,
  type RelaySummary,
  type SortKey,
} from "../../helpers/relay-directory";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();

// Loads monitor profiles and NIP-65 relay lists on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// NIP-77 negentropy sync per relay, with a paginated REQ fallback for relays that don't support it
const syncLoader = createSyncLoader({ eventStore, pool });

// Where monitors announce themselves, also synced alongside each monitor's outboxes
const DISCOVERY_RELAYS = ["wss://relay.nostr.watch/"];

// A few well known monitors are enough to discover most relays, syncing every monitor multiplies the data for little gain
const PRESET_MONITORS = [
  "9ba046db56b8e6682c48af8d6425ffe80430a3cd0854d95381af27c5d27ca0f7",
  "9ba6484003e8e88600f97ebffd897b2fe82753082e8e0cd8ea19aac0ff2b712b",
  "9bbbb845e5b6c831c29789900769843ab43bb5047abe697870cb50b6fc9bf923",
];

const HOUR = 60 * 60;
const WINDOWS = [
  ["1 hour", HOUR],
  ["6 hours", 6 * HOUR],
  ["24 hours", 24 * HOUR],
  ["7 days", 7 * 24 * HOUR],
  ["30 days", 30 * 24 * HOUR],
] as const;

type RunConfig = { monitors: string[]; since: number; extra: string[]; limit: number; concurrency: number };
type RunState = {
  monitors: Record<string, SyncLoaderStatus>;
  samples: { t: number; loaded: number }[];
  first?: number;
  ms: number;
  loaded: number;
  done: boolean;
  // Reports already in the store when the run started, more than zero makes it a warm run
  cached: number;
};

const reportsFilter = (monitors: string[], since: number) => ({
  kinds: [RELAY_DISCOVERY_KIND],
  authors: monitors,
  since,
});

/** The monitor's outboxes plus the extra relays, falling back to only the extras when it has no relay list */
const monitorRelays$ = (pubkey: string, extra: string[]) =>
  castUser(pubkey, eventStore).outboxes$.pipe(
    defined(),
    timeout({ first: 5_000, with: () => of([]) }),
    map((outboxes) => mergeRelaySets(outboxes, extra)),
    take(1),
  );

/** Syncs every monitor's reports in parallel */
function sync(config: RunConfig): Observable<RunState | Error> {
  return defer(() => {
    const start = performance.now();
    const cached = eventStore.getByFilters(reportsFilter(config.monitors, config.since)).length;
    const samples: RunState["samples"] = [];
    let first: number | undefined;

    // One sync per monitor, the loader reconciles a single filter and each monitor has its own outboxes
    const runs = config.monitors.map((pubkey) =>
      syncLoader({
        relays: monitorRelays$(pubkey, config.extra),
        filter: reportsFilter([pubkey], config.since),
        limit: config.limit,
        concurrency: config.concurrency,
      }).status$.pipe(map((status) => [pubkey, status] as const)),
    );

    return combineLatest(runs).pipe(
      map((entries): RunState => {
        const ms = performance.now() - start;
        const loaded = entries.reduce((sum, [, status]) => sum + status.loaded, 0);
        if (first === undefined && loaded > 0) first = ms;
        samples.push({ t: ms, loaded });
        return {
          monitors: Object.fromEntries(entries),
          samples: [...samples],
          first,
          ms,
          loaded,
          done: entries.every(([, status]) => status.done),
          cached,
        };
      }),
      catchError((error: Error) => of(error)),
    );
  });
}

const short = (relay: string) => relay.replace(/^wss?:\/\//, "").replace(/\/$/, "");
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const rtt = (ms?: number) => (ms === undefined ? "—" : `${ms}ms`);
const ago = (created: number) => {
  const s = unixNow() - created;
  return s < HOUR ? `${Math.round(s / 60)}m` : s < 24 * HOUR ? `${Math.round(s / HOUR)}h` : `${Math.round(s / 86400)}d`;
};

export default function RelayDirectory() {
  // Only the preset monitors are synced by default, others can be opted in from the list
  const [selected, setSelected] = useState<string[]>(PRESET_MONITORS);
  const [custom, setCustom] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [span, setSpan] = useState<number>(24 * HOUR);
  const [extraText, setExtraText] = useState(DISCOVERY_RELAYS.join("\n"));
  const [limit, setLimit] = useState(500);
  const [concurrency, setConcurrency] = useState(10);
  const [run, setRun] = useState<RunConfig | null>(null);
  // The table keeps showing the last run's reports after it is stopped
  const [view, setView] = useState<{ monitors: string[]; since: number }>();

  const [filters, setFilters] = useState<FacetFilters>({});
  const [search, setSearch] = useState("");
  const [maxRtt, setMaxRtt] = useState(0);
  const [minMonitors, setMinMonitors] = useState(1);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "monitors", dir: -1 });

  // Discover monitors from their kind 10166 announcements
  const monitors = use$(
    () =>
      merge(
        pool
          .request(mergeRelaySets(DISCOVERY_RELAYS, lookupRelays$.value), { kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND] })
          .pipe(mapEventsToStore(eventStore), ignoreElements()),
        eventStore
          .timeline({ kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND] })
          .pipe(castTimelineStream(RelayMonitor, eventStore)),
      ),
    [],
  );
  const listed = useMemo(
    () => [...new Set([...PRESET_MONITORS, ...(monitors ?? []).map((m) => m.event.pubkey), ...custom])],
    [monitors, custom],
  );

  const state = use$(() => (run ? sync(run) : EMPTY), [run]);
  const progress = state instanceof Error ? undefined : state;
  const running = !!run && !progress?.done;

  // Store every report as it arrives, then merge them into relays at most twice a second
  const relays = use$(
    () =>
      view
        ? eventStore
            .timeline(reportsFilter(view.monitors, view.since))
            .pipe(
              throttleTime(500, undefined, { leading: true, trailing: true }),
              castTimelineStream(RelayDiscovery, eventStore),
              map(aggregateRelays),
            )
        : EMPTY,
    [view],
  );

  // The search, latency and monitor filters apply before the facet counts
  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (relays ?? []).filter(
      (r) =>
        r.monitors.size >= minMonitors &&
        (!maxRtt || (r.rttOpen !== undefined && r.rttOpen <= maxRtt)) &&
        (!query || r.url.includes(query) || r.name?.toLowerCase().includes(query)),
    );
  }, [relays, search, maxRtt, minMonitors]);
  const results = useMemo(
    () =>
      candidates
        .filter((r) => matchesFacets(r, filters))
        .sort((a, b) => compareRelays(a, b, sort.key, sort.dir) || a.url.localeCompare(b.url)),
    [candidates, filters, sort],
  );

  const start = () => {
    const config = {
      monitors: selected,
      since: unixNow() - span,
      extra: mergeRelaySets(extraText.split(/\s+/)),
      limit,
      concurrency,
    };
    setView({ monitors: config.monitors, since: config.since });
    setRun(config);
  };
  const toggleMonitor = (pubkey: string) =>
    setSelected((list) => (list.includes(pubkey) ? list.filter((p) => p !== pubkey) : [...list, pubkey]));
  const addCustom = () => {
    if (/^[0-9a-f]{64}$/.test(customText)) {
      setCustom((list) => [...list, customText]);
      setSelected((list) => [...new Set([...list, customText])]);
    }
    setCustomText("");
  };
  const toggleFacet = (facet: Facet, value: string) => {
    const picked = filters[facet] ?? [];
    setFilters({
      ...filters,
      [facet]: picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value],
    });
  };
  const sortBy = (key: SortKey) =>
    setSort((s) => ({
      key,
      dir: s.key === key ? (-s.dir as 1 | -1) : key === "url" || key.startsWith("rtt") ? 1 : -1,
    }));
  const active = FACETS.flatMap(({ key }) => (filters[key] ?? []).map((value) => [key, value] as const));

  return (
    <div className="flex min-h-0 grow">
      <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto border-e border-base-300 p-3">
        <details className="collapse collapse-arrow rounded-none border border-base-300">
          <summary className="collapse-title font-semibold">
            Monitors{" "}
            <span className="font-normal text-base-content/60">
              ({selected.length} of {listed.length})
            </span>
          </summary>
          <div className="collapse-content flex flex-col p-0">
            <div className="flex max-h-72 flex-col divide-y divide-base-300 overflow-y-auto border-t border-base-300">
              {listed.map((pubkey) => (
                <MonitorRow
                  key={pubkey}
                  pubkey={pubkey}
                  monitor={monitors?.find((m) => m.event.pubkey === pubkey)}
                  checked={selected.includes(pubkey)}
                  onToggle={toggleMonitor}
                />
              ))}
            </div>
            <div className="join border-t border-base-300 p-2">
              <input
                className="input join-item flex-1 font-mono"
                placeholder="monitor pubkey (hex)"
                value={customText}
                onChange={(e) => setCustomText(e.target.value.trim())}
                onKeyDown={(e) => e.key === "Enter" && addCustom()}
              />
              <button className="btn join-item" onClick={addCustom}>
                Add
              </button>
            </div>
            <label className="flex flex-col gap-1 border-t border-base-300 p-2">
              <span>Extra relays, synced with every monitor's outboxes</span>
              <textarea
                className="textarea w-full font-mono"
                rows={2}
                value={extraText}
                onChange={(e) => setExtraText(e.target.value)}
              />
            </label>
            <div className="flex gap-2 border-t border-base-300 p-2">
              <NumberSelect label="page" value={limit} options={[100, 500, 1000, 5000]} onChange={setLimit} />
              <NumberSelect label="relays" value={concurrency} options={[2, 5, 10, 20]} onChange={setConcurrency} />
            </div>
          </div>
        </details>

        <div className="flex gap-2">
          <select className="select flex-1" value={span} onChange={(e) => setSpan(Number(e.target.value))}>
            {WINDOWS.map(([label, value]) => (
              <option key={value} value={value}>
                last {label}
              </option>
            ))}
          </select>
          <button
            className="btn btn-outline"
            disabled={running}
            title="Remove every relay report from the store so the next sync is cold"
            onClick={() => eventStore.removeByFilters({ kinds: [RELAY_DISCOVERY_KIND] })}
          >
            Reset
          </button>
        </div>
        {running ? (
          <button className="btn btn-outline" onClick={() => setRun(null)}>
            Stop
          </button>
        ) : (
          <button className="btn btn-primary" onClick={start} disabled={selected.length === 0}>
            Sync {selected.length} monitors
          </button>
        )}

        {relays &&
          FACETS.map(({ key, label, match }) => (
            <FacetList
              key={key}
              label={label}
              match={match}
              counts={countFacet(
                candidates.filter((r) => matchesFacets(r, filters, key)),
                key,
              )}
              picked={filters[key] ?? []}
              onToggle={(value) => toggleFacet(key, value)}
            />
          ))}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-3 p-3">
        {state instanceof Error && <div className="border border-error p-2 text-error">{state.message}</div>}
        {progress && <Stats state={progress} relays={relays?.length ?? 0} running={running} />}

        {relays ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                className="input w-72"
                placeholder="Search name or URL"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select className="select w-44" value={maxRtt} onChange={(e) => setMaxRtt(Number(e.target.value))}>
                <option value={0}>any open RTT</option>
                {[100, 300, 500, 1000].map((ms) => (
                  <option key={ms} value={ms}>
                    open under {ms}ms
                  </option>
                ))}
              </select>
              <select
                className="select w-52"
                value={minMonitors}
                onChange={(e) => setMinMonitors(Number(e.target.value))}
              >
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>
                    seen by {n}+ monitors
                  </option>
                ))}
              </select>
              <span className="ms-auto">
                <strong>{results.length.toLocaleString()}</strong> of {relays.length.toLocaleString()} relays
              </span>
            </div>
            {active.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {active.map(([facet, value]) => (
                  <button
                    key={facet + value}
                    className="badge badge-primary gap-1"
                    onClick={() => toggleFacet(facet, value)}
                  >
                    {facet}: {facetLabel(value)} ✕
                  </button>
                ))}
                <button className="btn btn-sm btn-ghost" onClick={() => setFilters({})}>
                  Clear
                </button>
              </div>
            )}
            <RelayTable relays={results} sort={sort} onSort={sortBy} onFacet={toggleFacet} />
          </>
        ) : (
          <p className="text-base-content/60">Pick a time window and sync the monitors to fill the directory.</p>
        )}

        {progress && (
          <details className="collapse collapse-arrow rounded-none border border-base-300">
            <summary className="collapse-title font-semibold">Sync details</summary>
            <div className="collapse-content flex max-h-96 flex-col gap-3 overflow-y-auto">
              {progress.samples.length > 1 && <ProgressCurve state={progress} />}
              <SyncTable state={progress} />
            </div>
          </details>
        )}
      </main>
    </div>
  );
}

function NumberSelect({
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
    <select
      className="select flex-1"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label={label}
    >
      {options.map((n) => (
        <option key={n} value={n}>
          {label} {n}
        </option>
      ))}
    </select>
  );
}

/** A monitor with its profile name and announced check frequency */
function MonitorRow({
  pubkey,
  monitor,
  checked,
  onToggle,
}: {
  pubkey: string;
  monitor?: RelayMonitor;
  checked: boolean;
  onToggle: (pubkey: string) => void;
}) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);

  return (
    <label className="flex cursor-pointer items-center gap-2 px-2 py-1">
      <input type="checkbox" className="checkbox" checked={checked} onChange={() => onToggle(pubkey)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{getDisplayName(profile, pubkey.slice(0, 12))}</span>
        <span className="truncate text-sm text-base-content/60">
          {monitor
            ? [monitor.frequency && `every ${monitor.frequency}s`, `seen ${ago(monitor.event.created_at)} ago`]
                .filter(Boolean)
                .join(" · ")
            : "no announcement found"}
        </span>
      </span>
    </label>
  );
}

/** Values of one facet with how many relays match each, given the other filters */
function FacetList({
  label,
  match,
  counts,
  picked,
  onToggle,
}: {
  label: string;
  match: "any" | "all";
  counts: [string, number][];
  picked: string[];
  onToggle: (value: string) => void;
}) {
  if (counts.length === 0 && picked.length === 0) return null;

  return (
    <details className="collapse collapse-arrow rounded-none border border-base-300" open={picked.length > 0}>
      <summary className="collapse-title font-semibold">
        {label}{" "}
        <span className="font-normal text-base-content/60">
          {picked.length > 0 ? `${picked.length} picked, match ${match}` : counts.length}
        </span>
      </summary>
      <div className="collapse-content max-h-64 overflow-y-auto border-t border-base-300 p-0">
        {counts.map(([value, count]) => (
          <label key={value} className="flex cursor-pointer items-center gap-2 px-2 py-1">
            <input
              type="checkbox"
              className="checkbox"
              checked={picked.includes(value)}
              onChange={() => onToggle(value)}
            />
            <span className="flex-1 truncate">{facetLabel(value)}</span>
            <span className="text-base-content/60">{count}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

const COLUMNS: { key?: SortKey; label: string }[] = [
  { key: "url", label: "Relay" },
  { label: "Network" },
  { label: "Software" },
  { label: "Country" },
  { key: "rttOpen", label: "Open" },
  { key: "rttRead", label: "Read" },
  { key: "rttWrite", label: "Write" },
  { key: "nips", label: "NIPs" },
  { label: "Requires" },
  { key: "monitors", label: "Monitors" },
  { key: "lastSeen", label: "Seen" },
];

/** The matching relays in a virtualized table, click a header to sort and a row to see every attribute */
function RelayTable({
  relays,
  sort,
  onSort,
  onFacet,
}: {
  relays: RelaySummary[];
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (key: SortKey) => void;
  onFacet: (facet: Facet, value: string) => void;
}) {
  const [open, setOpen] = useState<string>();
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  // Only the rows in view are rendered, rows are measured because an opened row is taller
  const virtualizer = useVirtualizer({
    count: relays.length,
    getScrollElement: () => scroller,
    getItemKey: (index) => relays[index].url,
    estimateSize: () => 66,
    overscan: 10,
  });
  const items = virtualizer.getVirtualItems();
  const before = items[0]?.start ?? 0;
  const after = virtualizer.getTotalSize() - (items[items.length - 1]?.end ?? 0);

  return (
    <div ref={setScroller} className="min-h-0 flex-1 overflow-auto border border-base-300">
      <table className="table table-pin-rows">
        <thead>
          <tr>
            {COLUMNS.map(({ key, label }) => (
              <th key={label}>
                {key ? (
                  <button className="link link-hover" onClick={() => onSort(key)}>
                    {label}
                    {sort.key === key && (sort.dir === 1 ? " ↑" : " ↓")}
                  </button>
                ) : (
                  label
                )}
              </th>
            ))}
          </tr>
        </thead>
        {before > 0 && (
          <tbody>
            <tr style={{ height: before }} />
          </tbody>
        )}
        {items.map((item) => {
          const relay = relays[item.index];
          return (
            // A table can have many bodies, one per relay keeps its detail row in the measured element
            <tbody key={item.key} data-index={item.index} ref={virtualizer.measureElement}>
              <RelayRow
                relay={relay}
                open={open === relay.url}
                onOpen={() => setOpen(open === relay.url ? undefined : relay.url)}
                onFacet={onFacet}
              />
            </tbody>
          );
        })}
        {after > 0 && (
          <tbody>
            <tr style={{ height: after }} />
          </tbody>
        )}
      </table>
    </div>
  );
}

function RelayRow({
  relay,
  open,
  onOpen,
  onFacet,
}: {
  relay: RelaySummary;
  open: boolean;
  onOpen: () => void;
  onFacet: (facet: Facet, value: string) => void;
}) {
  const list = (set: Set<string>) => [...set].join(", ") || "—";
  const requires = [...relay.requirement].filter((r) => !r.startsWith("!"));

  return (
    <>
      <tr className="cursor-pointer hover:bg-base-200" onClick={onOpen}>
        <td className="max-w-80">
          <div className="truncate font-semibold">{relay.name ?? short(relay.url)}</div>
          <div className="truncate font-mono text-sm text-base-content/60">{short(relay.url)}</div>
        </td>
        <td>{list(relay.network)}</td>
        <td>{list(relay.software)}</td>
        <td>{list(relay.country)}</td>
        <td>{rtt(relay.rttOpen)}</td>
        <td>{rtt(relay.rttRead)}</td>
        <td>{rtt(relay.rttWrite)}</td>
        <td>{relay.nip.size}</td>
        <td>{requires.join(", ") || "—"}</td>
        <td>{relay.monitors.size}</td>
        <td>{ago(relay.lastSeen)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={COLUMNS.length} className="bg-base-200">
            {relay.description && <p className="mb-2">{relay.description}</p>}
            <div className="flex flex-wrap gap-1">
              {FACETS.flatMap(({ key }) =>
                [...relay[key]].map((value) => (
                  <button
                    key={key + value}
                    className="badge badge-outline"
                    title="Filter by this value"
                    onClick={() => onFacet(key, value)}
                  >
                    {key}: {facetLabel(value)}
                  </button>
                )),
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Totals for the current sync */
function Stats({ state, relays, running }: { state: RunState; relays: number; running: boolean }) {
  const statuses = Object.values(state.monitors).flatMap((m) => Object.values(m.relays));
  const finished = statuses.filter((r) => r.state === "complete" || r.state === "error").length;
  const negentropy = statuses.filter((r) => r.method === "negentropy").length;
  const errors = statuses.filter((r) => r.state === "error").length;

  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-base-300 py-2">
      <span>
        Time <strong>{seconds(state.ms)}</strong>
      </span>
      <span>
        First report <strong>{state.first !== undefined ? seconds(state.first) : "—"}</strong>
      </span>
      <span>
        Reports <strong>{state.loaded.toLocaleString()}</strong>
      </span>
      <span>
        Reports/s <strong>{state.ms > 0 ? ((state.loaded / state.ms) * 1000).toFixed(0) : 0}</strong>
      </span>
      <span>
        Relays found <strong>{relays.toLocaleString()}</strong>
      </span>
      <span>
        Synced <strong>{finished}</strong> / {statuses.length}
      </span>
      <span>
        Negentropy <strong>{negentropy}</strong> / {statuses.length}
      </span>
      <span className={errors ? "text-error" : ""}>
        Errors <strong>{errors}</strong>
      </span>
      {state.cached > 0 && <span className="badge badge-info">Warm, {state.cached} cached</span>}
      {state.done && <span className="badge badge-success">Done</span>}
      {!state.done && !running && <span className="badge badge-warning">Stopped</span>}
    </div>
  );
}

/** Reports loaded over time */
function ProgressCurve({ state }: { state: RunState }) {
  const samples = state.samples;
  const maxT = Math.max(samples[samples.length - 1].t, 1);
  const maxN = Math.max(state.loaded, 1);
  const points = samples.map((s) => `${(s.t / maxT) * 1000},${200 - (s.loaded / maxN) * 200}`).join(" ");

  return (
    <section className="border border-base-300">
      <h2 className="flex gap-4 border-b border-base-300 px-2 py-1">
        <span className="font-semibold">Progress</span>
        <span className="ms-auto">
          {maxN.toLocaleString()} reports · {seconds(maxT)}
        </span>
      </h2>
      <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="h-32 w-full">
        <polyline
          points={points}
          fill="none"
          className="stroke-success"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </section>
  );
}

/** Every relay of every monitor with its sync method and count */
function SyncTable({ state }: { state: RunState }) {
  const rows = Object.entries(state.monitors).flatMap(([pubkey, progress]) =>
    Object.values(progress.relays).map((status) => ({ pubkey, status })),
  );
  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto border border-base-300">
      <table className="table">
        <thead>
          <tr>
            <th>Monitor</th>
            <th>Relay</th>
            <th>State</th>
            <th>NIP-77</th>
            <th>Method</th>
            <th>Reports</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ pubkey, status }) => (
            <SyncRow key={pubkey + status.relay} pubkey={pubkey} status={status} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SyncRow({ pubkey, status }: { pubkey: string; status: SyncRelayStatus }) {
  const profile = use$(() => castUser(pubkey, eventStore).profile$, [pubkey]);

  return (
    <tr>
      <td>{getDisplayName(profile, pubkey.slice(0, 8))}</td>
      <td title={status.relay}>{short(status.relay)}</td>
      <td className={status.state === "error" ? "text-error" : ""} title={status.error?.message}>
        {status.state}
      </td>
      <td>{status.negentropy === undefined ? "—" : status.negentropy ? "yes" : "no"}</td>
      <td title={status.fallbackReason?.message}>
        {status.method ?? "—"}
        {status.fallbackReason && " (fallback)"}
      </td>
      <td>{status.count.toLocaleString()}</td>
    </tr>
  );
}
