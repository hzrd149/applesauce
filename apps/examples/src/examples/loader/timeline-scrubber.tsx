/**
 * Scrub a user's timeline backward and forward across their NIP-65 outbox relays to stress test the timeline loader
 * @tags loader, timeline, outbox, nip-65, stress
 * @related loader/paginated-timeline, outbox/social-feed
 */
import { castUser } from "applesauce-common/casts";
import { EventStore } from "applesauce-core";
import { getSeenRelays, unixNow } from "applesauce-core/helpers";
import type { NostrEvent } from "applesauce-core/helpers/event";
import { defined } from "applesauce-core/observable";
import { createEventLoaderForStore, createOutboxTimelineLoader, TimelineWindow } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useCallback, useRef, useState } from "react";
import {
  BehaviorSubject,
  catchError,
  defer,
  EMPTY,
  identity,
  ignoreElements,
  interval,
  map,
  merge,
  mergeMap,
  of,
  scan,
  startWith,
  tap,
  throttleTime,
  toArray,
} from "rxjs";

import { crawlWindow, MonitorSnapshot, TimelineMonitor } from "../../helpers/timeline-stress";
import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

// Very active users to scrub through, any other user can be picked below
const PRESETS = [
  { name: "fiatjaf", pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" },
  { name: "Gigi", pubkey: "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93" },
  { name: "Derek Ross", pubkey: "3f770d65d3a764a9c5cb503ae123e62ec7598ad035d836e2a810f3877a745b24" },
  { name: "ODELL", pubkey: "04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9" },
  { name: "PABLOF7z", pubkey: "fa984bd7dbb282f07e16e7ae87b26a2a7b9b90b7246a44771f0cf5ae58018f52" },
  { name: "jb55", pubkey: "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245" },
  { name: "Vitor Pamplona", pubkey: "460c25e682fda7832b52d1f22d3d22b3176d972f60dcdc3212ed8c92ef85065c" },
  { name: "hzrd149", pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5" },
];
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const SPANS = [
  ["1h", HOUR],
  ["6h", 6 * HOUR],
  ["1d", DAY],
  ["1w", 7 * DAY],
  ["30d", 30 * DAY],
] as const;
const OVERVIEWS = [
  ["1w", 7 * DAY],
  ["30d", 30 * DAY],
  ["90d", 90 * DAY],
  ["1y", 365 * DAY],
] as const;
const MIN_SPAN = 60;
const STUCK_MS = 15_000;
// SVG units across the overview, ticks are binned into these columns
const WIDTH = 1000;
const LANE = 28;

// Skip signature checks, this example measures loading not verification and thousands of events cost CPU time
const eventStore = new EventStore({ verifyEvent: () => true });
const pool = new RelayPool();

// Load the users NIP-65 relay list on demand
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Records every REQ the loader sends and every loader() call, so problems are visible
const monitor = new TimelineMonitor();
const request = monitor.instrument((relays, filters) => pool.request(relays, filters));

const DEFAULT_OVERVIEW = 30 * DAY;

/** A one day window in the middle of the overview, so a fresh loader has history to walk both backward and forward */
function middle(overview: number) {
  const until = unixNow() - overview / 2 + DAY / 2;
  return { since: Math.round(until - DAY), until: Math.round(until) };
}

// The visible time window, the single source of truth for what the loader should load
const window$ = new BehaviorSubject<Required<TimelineWindow>>(middle(DEFAULT_OVERVIEW));

/** Creates a fresh loader for a user and feeds it every window change */
function scrub(pubkey: string, limit: number, throttle: number) {
  return defer(() => {
    monitor.reset();
    // Start from an empty store so earlier runs can't hide gaps
    eventStore.removeByFilters({ kinds: [1], authors: [pubkey] });

    // Map the users NIP-65 outboxes to an outbox map, the loader waits until it is known
    const outboxes$ = castUser(pubkey, eventStore).outboxes$.pipe(
      defined(),
      map((relays) => Object.fromEntries(relays.map((relay) => [relay, [{ pubkey }]]))),
      monitor.countMaps(),
    );

    const loader = createOutboxTimelineLoader(request, outboxes$, { kinds: [1] }, { limit, eventStore });

    return window$.pipe(
      throttle ? throttleTime(throttle, undefined, { leading: true, trailing: true }) : identity,
      // Keep overlapping calls alive so each one has to complete on its own
      mergeMap((window) => monitor.trackCall(window, loader(window))),
      // Events are rendered from the store
      ignoreElements(),
      catchError((error: Error) => of(error)),
    );
  });
}

/** Keeps a window inside the overview and at least a minute wide */
function clamp(since: number, until: number, start: number, end: number) {
  const span = Math.min(Math.max(until - since, MIN_SPAN), end - start);
  if (until > end) until = end;
  if (until - span < start) until = start + span;
  return { since: Math.round(until - span), until: Math.round(until) };
}

const date = (t?: number) => (t === undefined ? "—" : new Date(t * 1000).toLocaleString());
const short = (relay: string) => relay.replace(/^wss:\/\//, "").replace(/\/$/, "");

type AuditResult = { relay: string; state: "running" | "done" | "error"; events: NostrEvent[] };

export default function TimelineScrubber() {
  const [pubkey, setPubkey] = useState(PRESETS[0].pubkey);
  const [limit, setLimit] = useState(100);
  const [throttle, setThrottle] = useState(250);
  const [overview, setOverview] = useState(DEFAULT_OVERVIEW);
  const [reset, setReset] = useState(0);
  const [chaos, setChaos] = useState(false);
  const [audit, setAudit] = useState<{ since: number; until: number }>();

  // Fresh loaders start in the middle of the overview. The window is set before the loader is recreated
  const restart = () => {
    window$.next(middle(overview));
    setReset((n) => n + 1);
  };
  // Stable so the picker's NIP-05 lookup isn't restarted on every render, and ignores the empty value of a cleared input
  const pick = useCallback(
    (pk: string) => {
      if (!pk) return;
      window$.next(middle(overview));
      setPubkey(pk);
    },
    [overview],
  );

  const end = unixNow();
  const start = end - overview;
  const win = use$(window$);

  // Run the loader, recreating it when the user, limit or throttle changes
  const error = use$(() => scrub(pubkey, limit, throttle), [pubkey, limit, throttle, reset]);

  const relays = use$(() => castUser(pubkey, eventStore).outboxes$, [pubkey]) ?? [];
  const stats = use$(monitor.snapshot$);
  const events = use$(() => eventStore.timeline({ kinds: [1], authors: [pubkey] }), [pubkey, reset]) ?? [];

  // Randomly pan, resize and jump the window to hammer the loader
  use$(
    () =>
      chaos
        ? interval(400).pipe(
            tap(() => {
              const end = unixNow();
              const start = end - overview;
              const { since, until } = window$.value;
              const span = until - since;
              const roll = Math.random();
              if (roll < 0.4) {
                const shift = (Math.random() - 0.5) * span;
                window$.next(clamp(since + shift, until + shift, start, end));
              } else if (roll < 0.7) {
                const next = span * (0.5 + Math.random() * 1.5);
                window$.next(clamp(until - next, until, start, end));
              } else {
                const t = start + Math.random() * overview;
                window$.next(clamp(t - span, t, start, end));
              }
            }),
            ignoreElements(),
          )
        : EMPTY,
    [chaos, overview],
  );

  // Independently crawl the window on every relay to find events the loader missed
  const auditResults = use$(
    () =>
      audit
        ? merge(
            ...relays.map((relay) =>
              crawlWindow(
                (r, f) => pool.request(r, f),
                relay,
                { kinds: [1], authors: [pubkey] },
                audit.since,
                audit.until,
              ).pipe(
                toArray(),
                map((events): AuditResult => ({ relay, state: "done", events })),
                catchError(() => of<AuditResult>({ relay, state: "error", events: [] })),
                startWith<AuditResult>({ relay, state: "running", events: [] }),
              ),
            ),
          ).pipe(scan((all, result) => ({ ...all, [result.relay]: result }), {} as Record<string, AuditResult>))
        : of(undefined),
    [audit, relays.join(), pubkey],
  );

  const jump = (t: number) => {
    const span = win.until - win.since;
    window$.next(clamp(t - span, t, start, end));
    // A fresh loader starts at the jump, so scrubbing toward now has to walk forward
    setReset((n) => n + 1);
  };

  const now = Date.now();
  const calls = stats?.calls ?? [];
  const requests = stats?.requests ?? [];
  const count = (state: string) => requests.filter((r) => r.state === state).length;
  const pending = calls.filter((c) => c.state === "pending");
  const stuck = pending.filter((c) => now - c.start > STUCK_MS).length;
  const inWindow = events.filter((e) => e.created_at >= win.since && e.created_at <= win.until);

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

      <div className="flex flex-wrap items-center gap-2">
        <select
          className="select w-32"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          aria-label="Limit"
        >
          {[20, 100, 500].map((n) => (
            <option key={n} value={n}>
              limit {n}
            </option>
          ))}
        </select>
        <select
          className="select w-40"
          value={throttle}
          onChange={(e) => setThrottle(Number(e.target.value))}
          aria-label="Throttle"
        >
          {[0, 250, 1000].map((n) => (
            <option key={n} value={n}>
              throttle {n}ms
            </option>
          ))}
        </select>
        <div className="join">
          {SPANS.map(([label, span]) => (
            <button
              key={label}
              className="btn join-item"
              onClick={() => window$.next(clamp(win.until - span, win.until, start, end))}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => window$.next(clamp(end - (win.until - win.since), end, start, end))}>
          Now
        </button>
        <input
          type="date"
          className="input w-44"
          aria-label="Jump to date"
          onChange={(e) => e.target.valueAsNumber && jump(e.target.valueAsNumber / 1000 + DAY)}
        />
        <label className="label gap-2">
          <input type="checkbox" className="toggle" checked={chaos} onChange={(e) => setChaos(e.target.checked)} />
          Chaos scrub
        </label>
        <button className="btn" onClick={() => setAudit({ since: win.since, until: Math.min(win.until, unixNow()) })}>
          Verify window
        </button>
        <button className="btn btn-outline" onClick={restart}>
          Reset
        </button>
      </div>

      {error instanceof Error && <div className="border border-error p-2 text-error">{error.message}</div>}

      <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-base-300 py-2">
        <span>
          Loaded <strong>{events.length}</strong>
        </span>
        <span>
          In window <strong>{inWindow.length}</strong>
        </span>
        <span>
          Calls <strong>{pending.length}</strong> pending / <strong>{calls.length - pending.length}</strong> settled
        </span>
        <span className={stuck ? "text-error" : ""}>
          Stuck calls <strong>{stuck}</strong>
        </span>
        <span>
          REQs <strong>{count("active")}</strong> active / <strong>{count("complete")}</strong> complete /{" "}
          <strong>{count("cancelled")}</strong> cancelled / <strong>{count("error")}</strong> error
        </span>
        <span className={calls.some((c) => c.duplicates) ? "text-error" : ""}>
          Duplicates <strong>{calls.reduce((n, c) => n + c.duplicates, 0)}</strong>
        </span>
        <span>
          Outbox map emissions <strong>{stats?.maps ?? 0}</strong>
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span>Overview</span>
        <div className="join">
          {OVERVIEWS.map(([label, span]) => (
            <button
              key={label}
              className={`btn join-item ${overview === span ? "btn-active" : ""}`}
              onClick={() => setOverview(span)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ms-auto">
          {date(win.since)} → {date(win.until)}
        </span>
      </div>

      <Overview relays={relays} events={events} stats={stats} audit={auditResults} win={win} start={start} end={end} />

      <div className="grid min-h-96 grid-cols-1 gap-3 lg:grid-cols-2">
        <WindowList events={inWindow} />
        <RequestLog stats={stats} />
      </div>

      <RelayTable relays={relays} stats={stats} audit={auditResults} />
    </div>
  );
}

type OverviewProps = {
  relays: string[];
  events: NostrEvent[];
  stats?: MonitorSnapshot;
  audit?: Record<string, AuditResult>;
  win: { since: number; until: number };
  start: number;
  end: number;
};

/** Relay lanes with REQ spans and event ticks, plus a brush that drives the window */
function Overview({ relays, events, stats, audit, win, start, end }: OverviewProps) {
  const span = end - start;
  const x = (t: number) => ((t - start) / span) * WIDTH;
  const height = (relays.length + 1) * LANE;
  const drag = useRef<{ mode: "move" | "since" | "until" | "new"; t: number; since: number; until: number }>(undefined);

  // Bin timestamps into columns so thousands of events stay cheap to render
  const bins = (times: Iterable<number>) => {
    const cols = new Set<number>();
    for (const t of times) if (t >= start && t <= end) cols.add(Math.floor(x(t)));
    return [...cols];
  };

  const toTime = (el: Element, clientX: number) => {
    const rect = el.getBoundingClientRect();
    return start + ((clientX - rect.left) / rect.width) * span;
  };

  // Zoom the window around the cursor with the mouse wheel, needs a non-passive listener to stop page scrolling
  const wheel = useCallback(
    (el: SVGSVGElement | null) => {
      if (!el) return;
      const listener = (e: WheelEvent) => {
        e.preventDefault();
        const t = toTime(el, e.clientX);
        const { since, until } = window$.value;
        const k = e.deltaY > 0 ? 1.25 : 0.8;
        window$.next(clamp(t - (t - since) * k, t + (until - t) * k, start, end));
      };
      el.addEventListener("wheel", listener, { passive: false });
      return () => el.removeEventListener("wheel", listener);
    },
    [start, end],
  );

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const t = toTime(e.currentTarget, e.clientX);
    const tolerance = (8 / e.currentTarget.getBoundingClientRect().width) * span;
    const mode =
      Math.abs(t - win.since) < tolerance
        ? "since"
        : Math.abs(t - win.until) < tolerance
          ? "until"
          : t > win.since && t < win.until
            ? "move"
            : "new";
    drag.current = { mode, t, ...win };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const t = toTime(e.currentTarget, e.clientX);
    const delta = t - d.t;
    if (d.mode === "move") window$.next(clamp(d.since + delta, d.until + delta, start, end));
    else if (d.mode === "since") window$.next(clamp(Math.min(t, d.until - MIN_SPAN), d.until, start, end));
    else if (d.mode === "until") window$.next(clamp(d.since, Math.max(t, d.since + MIN_SPAN), start, end));
    else window$.next(clamp(Math.min(t, d.t), Math.max(t, d.t), start, end));
  };

  const lane = (
    key: string,
    i: number,
    label: string,
    ticks: number[],
    reqs = stats?.requests ?? [],
    missing: number[] = [],
  ) => (
    <g key={key} transform={`translate(0 ${i * LANE})`}>
      <title>{label}</title>
      <line x1={0} x2={WIDTH} y1={LANE} y2={LANE} className="text-base-300" stroke="currentColor" />
      {reqs.slice(-300).map((r) => {
        const from = Math.max(r.since ?? (r.count ? r.oldest! : start), start);
        const to = Math.min(r.until ?? end, end);
        if (to < start) return null;
        const color = { active: "text-info", complete: "text-success", cancelled: "text-warning", error: "text-error" }[
          r.state
        ];
        return (
          <rect
            key={r.id}
            x={x(from)}
            y={2}
            width={Math.max(x(to) - x(from), 1)}
            height={LANE / 2 - 4}
            className={color}
            fill="currentColor"
            fillOpacity={r.state === "active" ? 0.6 : 0.25}
          />
        );
      })}
      {ticks.map((col) => (
        <rect
          key={col}
          x={col}
          y={LANE / 2}
          width={1}
          height={LANE / 2 - 2}
          className="text-base-content"
          fill="currentColor"
        />
      ))}
      {missing.map((col) => (
        <rect key={`m${col}`} x={col} y={0} width={2} height={LANE} className="text-error" fill="currentColor" />
      ))}
    </g>
  );

  return (
    <div className="flex border border-base-300">
      <div className="flex w-48 shrink-0 flex-col border-r border-base-300">
        <div className="truncate px-2 text-sm" style={{ height: LANE, lineHeight: `${LANE}px` }}>
          All relays (store)
        </div>
        {relays.map((relay) => (
          <div
            key={relay}
            className="truncate px-2 text-sm"
            style={{ height: LANE, lineHeight: `${LANE}px` }}
            title={relay}
          >
            {short(relay)}
          </div>
        ))}
      </div>
      <svg
        ref={wheel}
        viewBox={`0 0 ${WIDTH} ${height}`}
        preserveAspectRatio="none"
        className="grow cursor-crosshair touch-none select-none"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = undefined)}
      >
        {lane("store", 0, "All events in the store", bins(events.map((e) => e.created_at)), [])}
        {relays.map((relay, i) => {
          const received = stats?.received.get(relay);
          const missing = audit?.[relay]?.events.filter((e) => !received?.has(e.id)).map((e) => e.created_at) ?? [];
          return lane(
            relay,
            i + 1,
            relay,
            bins(received?.values() ?? []),
            stats?.requests.filter((r) => r.relay === relay),
            bins(missing),
          );
        })}
        <rect
          x={x(win.since)}
          y={0}
          width={Math.max(x(win.until) - x(win.since), 2)}
          height={height}
          className="text-base-content"
          fill="currentColor"
          fillOpacity={0.08}
          stroke="currentColor"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

/** The events inside the current window, newest first */
function WindowList({ events }: { events: NostrEvent[] }) {
  return (
    <section className="flex min-h-0 flex-col border border-base-300">
      <h2 className="border-b border-base-300 px-2 py-1 font-semibold">Events in window ({events.length})</h2>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {events.slice(0, 300).map((event) => (
          <div key={event.id} className="flex gap-3 border-b border-base-300 px-2 py-1 text-sm">
            <span className="shrink-0 font-mono">{date(event.created_at)}</span>
            <span className="shrink-0">{getSeenRelays(event)?.size ?? 0} relays</span>
            <span className="truncate">{event.content}</span>
          </div>
        ))}
        {events.length > 300 && <div className="px-2 py-1 text-sm">+{events.length - 300} more</div>}
      </div>
    </section>
  );
}

/** The most recent requests the loader sent */
function RequestLog({ stats }: { stats?: MonitorSnapshot }) {
  const requests = (stats?.requests ?? []).slice(-100).reverse();
  return (
    <section className="flex min-h-0 flex-col border border-base-300">
      <h2 className="border-b border-base-300 px-2 py-1 font-semibold">REQ log ({stats?.requests.length ?? 0})</h2>
      <ol className="min-h-0 flex-1 overflow-y-auto font-mono text-sm">
        {requests.map((r) => (
          <li
            key={r.id}
            className={`border-b border-base-300 px-2 py-1 ${r.state === "error" ? "text-error" : r.state === "cancelled" ? "text-warning" : ""}`}
          >
            #{r.id} {short(r.relay)} since={date(r.since)} until={date(r.until)} limit={r.limit ?? "—"} → {r.count}{" "}
            {r.state}
            {r.end && ` ${r.end - r.start}ms`}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Per relay totals and the result of the last verification */
function RelayTable({
  relays,
  stats,
  audit,
}: {
  relays: string[];
  stats?: MonitorSnapshot;
  audit?: Record<string, AuditResult>;
}) {
  return (
    <div className="overflow-x-auto border border-base-300">
      <table className="table">
        <thead>
          <tr>
            <th>Relay</th>
            <th>Received</th>
            <th>Oldest</th>
            <th>Newest</th>
            <th>REQs (active / cancelled / error)</th>
            <th>Verified</th>
            <th>Missing from relay</th>
            <th>Missing from store</th>
          </tr>
        </thead>
        <tbody>
          {relays.map((relay) => {
            const received = stats?.received.get(relay);
            const times = [...(received?.values() ?? [])];
            const reqs = stats?.requests.filter((r) => r.relay === relay) ?? [];
            const result = audit?.[relay];
            const missing = result?.events.filter((e) => !received?.has(e.id)).length ?? 0;
            const lost = result?.events.filter((e) => !eventStore.hasEvent(e.id)).length ?? 0;
            return (
              <tr key={relay}>
                <td title={relay}>{short(relay)}</td>
                <td>{received?.size ?? 0}</td>
                <td>{times.length ? date(Math.min(...times)) : "—"}</td>
                <td>{times.length ? date(Math.max(...times)) : "—"}</td>
                <td>
                  {reqs.length} ({reqs.filter((r) => r.state === "active").length} /{" "}
                  {reqs.filter((r) => r.state === "cancelled").length} /{" "}
                  {reqs.filter((r) => r.state === "error").length})
                </td>
                <td>{result ? (result.state === "done" ? result.events.length : result.state) : "—"}</td>
                <td className={missing ? "text-error" : ""}>{result?.state === "done" ? missing : "—"}</td>
                <td className={lost ? "text-error" : ""}>{result?.state === "done" ? lost : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
