/**
 * Race request completion conditions against one live REQ across many relays and audit what each one keeps and misses
 * @tags relay, pool, request, completion, eose, performance
 * @related feed/relay-timeline, outbox/relay-selection
 */
import { getTagValue, relaySet, type Filter } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import {
  GroupReqMessage,
  GroupRequestCompleteOperator,
  RelayFirstResponseTimeoutError,
  RelayGroup,
  RelayPool,
} from "applesauce-relay";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import { useMemo, useState } from "react";
import {
  asapScheduler,
  catchError,
  concat,
  defer,
  EMPTY,
  filter as rxFilter,
  ignoreElements,
  interval,
  lastValueFrom,
  map,
  merge,
  type Observable,
  of,
  scan,
  share,
  startWith,
  subscribeOn,
  take,
  takeUntil,
  tap,
  timer,
  toArray,
} from "rxjs";

import RelayPicker from "../../components/relay-picker";

const pool = new RelayPool({
  informationCache: new Keyv({ store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "nip11" }) }),
});

const DEFAULT_RELAYS = relaySet([
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
  "wss://relay.snort.social",
  "wss://nostr.wine",
  "wss://nostr-pub.wellorder.net",
  "wss://relay.nostr.band", // Unreachable, shows how a failed relay is settled
]);

// Omit limits to stress completion conditions with the largest responses each relay allows
const FILTERS: [string, Filter][] = [
  ["Contact lists", { kinds: [3] }],
  ["Recent notes", { kinds: [1] }],
  ["Profiles", { kinds: [0] }],
  ["Articles", { kinds: [30023] }],
];

type Settings = {
  grace: number;
  progress: number;
  idle: number;
  cap: number;
  window: number;
  quorum: number;
  target: number;
  firstResponse: number | false;
  timeout: number;
};

const DEFAULTS: Settings = {
  grace: 3_000,
  progress: 5_000,
  idle: 1_500,
  cap: 15_000,
  window: 5_000,
  quorum: 2,
  target: 100,
  firstResponse: 10_000,
  timeout: 30_000,
};

// Custom conditions are plain operators over the group's messages, the first truthy value completes the request
const firstEose = (): GroupRequestCompleteOperator => (messages$) => messages$.pipe(rxFilter((m) => m.type === "EOSE"));

const relaysFinished =
  (count: number): GroupRequestCompleteOperator =>
  (messages$) =>
    messages$.pipe(
      rxFilter((m) => m.type === "EOSE"),
      scan((n) => n + 1, 0),
      map((n) => n >= count),
    );

const uniqueEvents =
  (count: number): GroupRequestCompleteOperator =>
  (messages$) =>
    messages$.pipe(
      rxFilter((m) => m.type === "EVENT"),
      scan((ids, m) => ids.add(m.event.id), new Set<string>()),
      map((ids) => ids.size >= count),
    );

const CONDITIONS = [
  {
    id: "idle",
    label: "Idle-aware",
    tag: "default",
    color: ["text-teal-500", "bg-teal-500"],
    code: (s: Settings) =>
      `RelayGroup.completeAfterIdle({ grace: ${s.grace}, idle: ${s.idle}, progress: ${s.progress}, cap: ${s.cap} })`,
    complete: (s: Settings) =>
      RelayGroup.completeAfterIdle({ grace: s.grace, idle: s.idle, progress: s.progress, cap: s.cap }),
  },
  {
    id: "window",
    label: "Fixed window",
    tag: "v6 default",
    color: ["text-orange-500", "bg-orange-500"],
    code: (s: Settings) => `RelayGroup.completeAfterFirstRelay(${s.window})`,
    complete: (s: Settings) => RelayGroup.completeAfterFirstRelay(s.window),
  },
  {
    id: "all",
    label: "Every relay",
    color: ["text-purple-500", "bg-purple-500"],
    code: () => "RelayGroup.completeOnAllEose()",
    complete: () => RelayGroup.completeOnAllEose(),
  },
  {
    id: "first",
    label: "First EOSE",
    color: ["text-yellow-500", "bg-yellow-500"],
    code: () => `(m$) => m$.pipe(filter((m) => m.type === "EOSE"))`,
    complete: () => firstEose(),
  },
  {
    id: "quorum",
    label: "Relay quorum",
    color: ["text-blue-500", "bg-blue-500"],
    code: (s: Settings) => `relaysFinished(${s.quorum})`,
    complete: (s: Settings) => relaysFinished(s.quorum),
  },
  {
    id: "target",
    label: "Enough events",
    color: ["text-pink-500", "bg-pink-500"],
    code: (s: Settings) => `uniqueEvents(${s.target})`,
    complete: (s: Settings) => uniqueEvents(s.target),
  },
  {
    id: "any",
    label: "Enough events, else idle",
    color: ["text-lime-500", "bg-lime-500"],
    code: (s: Settings) => `RelayGroup.completeOnAny(uniqueEvents(${s.target}), RelayGroup.completeAfterIdle())`,
    complete: (s: Settings) => RelayGroup.completeOnAny(uniqueEvents(s.target), RelayGroup.completeAfterIdle()),
  },
] as const;
type ConditionId = (typeof CONDITIONS)[number]["id"];

type Ignored = "after EOSE" | "after failure";
type Entry = {
  t: number;
  from: string;
  type: GroupReqMessage["type"];
  id?: string;
  reason?: string;
  ignored?: Ignored;
};
type Snapshot = {
  elapsed: number;
  done: boolean;
  entries: Entry[];
  fired: Partial<Record<ConditionId, number>>;
  errors: Partial<Record<ConditionId, string>>;
};
type Run = { relays: string[]; filter: Filter; settings: Settings; id: number };

const toEntry = (m: GroupReqMessage, t: number, ignored?: Ignored): Entry => ({
  t,
  from: m.from,
  type: m.type,
  ignored,
  id: m.type === "EVENT" ? m.event.id : undefined,
  reason:
    m.type === "ERROR"
      ? m.error instanceof Error
        ? m.error.message
        : m.error instanceof CloseEvent
          ? `connection closed (${m.error.code})`
          : String(m.error)
      : m.type === "CLOSED"
        ? m.reason
        : undefined,
});

/** Sends one raw REQ to every relay and runs every completion condition against the same messages */
function race({ relays, filter, settings }: Run): Observable<Snapshot> {
  return defer(() => {
    const start = performance.now();
    const now = () => Math.round(performance.now() - start);
    const entries: Entry[] = [];
    const fired: Snapshot["fired"] = {};
    const errors: Snapshot["errors"] = {};
    const finished = new Map<string, Ignored>();

    // One shared REQ so every condition judges exactly the same relay responses. OPEN messages are emitted
    // synchronously, so connect only after every condition has subscribed
    const raw$ = pool.group(relays).req(filter).pipe(subscribeOn(asapScheduler), share());

    // request() fails a relay that sends no EVENT or EOSE within firstResponseTimeout
    const silent$ =
      settings.firstResponse === false
        ? EMPTY
        : merge(
            ...relays.map((url) =>
              timer(settings.firstResponse as number).pipe(
                takeUntil(raw$.pipe(rxFilter((m) => m.from === url && m.type !== "OPEN"))),
                map((): GroupReqMessage => ({
                  type: "ERROR",
                  from: url,
                  error: new RelayFirstResponseTimeoutError(url),
                })),
              ),
            ),
          );

    // Records every message before anything reacts to it, so the message that ends the observation is never lost.
    // A message is ignored when its relay already sent EOSE or failed, matching what request() acts on
    const recorded$ = merge(raw$, silent$).pipe(
      map((message) => {
        const ignored = finished.get(message.from);
        entries.push(toEntry(message, now(), ignored));
        if (!ignored && message.type !== "OPEN" && message.type !== "EVENT")
          finished.set(message.from, message.type === "EOSE" ? "after EOSE" : "after failure");
        return { message, ignored };
      }),
      share(),
    );
    const accepted$ = recorded$.pipe(
      rxFilter((r) => !r.ignored),
      map((r) => r.message),
      share(),
    );

    // A throwing condition is recorded instead of ending the whole run
    const fired$ = merge(
      ...CONDITIONS.map((c) =>
        accepted$.pipe(
          c.complete(settings),
          rxFilter(Boolean),
          take(1),
          tap(() => (fired[c.id] = now())),
          catchError((error) => {
            errors[c.id] = error instanceof Error ? error.message : String(error);
            return EMPTY;
          }),
        ),
      ),
    );

    // Keep observing until every relay really finishes, so late responses stay visible, or the request timeout passes
    const end$ = merge(
      timer(settings.timeout),
      recorded$.pipe(
        map((r) => r.message),
        rxFilter(
          (m) =>
            m.type !== "OPEN" &&
            m.type !== "EVENT" &&
            !(m.type === "ERROR" && m.error instanceof RelayFirstResponseTimeoutError),
        ),
        scan((done, m) => done.add(m.from), new Set<string>()),
        rxFilter((done) => done.size >= relays.length),
      ),
    );

    const snapshot = (done: boolean): Snapshot => ({
      elapsed: now(),
      done,
      entries: [...entries],
      fired: { ...fired },
      errors: { ...errors },
    });
    return concat(
      merge(merge(accepted$, fired$).pipe(ignoreElements()), interval(100)).pipe(
        takeUntil(end$),
        map(() => snapshot(false)),
        startWith(snapshot(false)),
      ),
      defer(() => of(snapshot(true))),
    );
  });
}

type RelayRow = {
  url: string;
  first?: number;
  end?: Entry;
  events: number;
  duplicates: number;
  only: number;
  late: number;
  times: number[];
  lateTimes: number[];
};

/** Derives per-relay stats and when request()'s cohort settlement would complete */
function analyze(relays: string[], entries: Entry[]) {
  const rows = new Map<string, RelayRow>(
    relays.map((url) => [url, { url, events: 0, duplicates: 0, only: 0, late: 0, times: [], lateTimes: [] }]),
  );
  const firstSeen = new Map<string, number>();
  const sources = new Map<string, Set<string>>();
  let settled: number | undefined;

  for (const e of entries) {
    const row = rows.get(e.from);
    if (!row) continue;
    if (e.ignored) {
      if (e.type === "EVENT" && e.ignored === "after failure") {
        row.late++;
        row.lateTimes.push(e.t);
      }
      continue;
    }
    if (e.type === "EVENT" && e.id) {
      row.events++;
      row.times.push(e.t);
      if (firstSeen.has(e.id)) row.duplicates++;
      else firstSeen.set(e.id, e.t);
      sources.set(e.id, (sources.get(e.id) ?? new Set()).add(e.from));
    }
    if (row.first === undefined && (e.type === "EVENT" || e.type === "EOSE")) row.first = e.t;
    if (e.type !== "OPEN" && e.type !== "EVENT" && !row.end) {
      row.end = e;
      if (settled === undefined && [...rows.values()].every((r) => r.end)) settled = e.t;
    }
  }
  for (const set of sources.values()) if (set.size === 1) rows.get([...set][0])!.only++;

  const allFailed = settled !== undefined && [...rows.values()].every((r) => r.end?.type !== "EOSE");
  return { rows: [...rows.values()], firstSeen, settled, allFailed };
}

const fmt = (ms?: number) => (ms === undefined ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);
const host = (url: string) => url.replace(/^wss?:\/\//, "").replace(/\/$/, "");

const WIDTH = 1000;
const LANE = 28;

function Lanes({
  rows,
  span,
  marks,
  settled,
  selected,
}: {
  rows: RelayRow[];
  span: number;
  marks: { id: string; t: number; color: string }[];
  settled?: number;
  selected?: string;
}) {
  const x = (t: number) => (t / span) * WIDTH;
  const bins = (times: number[]) => [...new Set(times.map((t) => Math.floor(x(t))))];
  const height = rows.length * LANE;
  const cut = marks.find((m) => m.id === selected);
  const ticks = Array.from({ length: Math.floor(span / 1000) + 1 }, (_, i) => i * 1000).filter(
    (_, i, all) => all.length <= 16 || i % Math.ceil(all.length / 16) === 0,
  );

  return (
    <div className="border border-base-300">
      <div className="flex">
        <div className="w-48 shrink-0 border-r border-base-300">
          {rows.map((row) => (
            <div
              key={row.url}
              className="truncate px-2 text-sm"
              style={{ height: LANE, lineHeight: `${LANE}px` }}
              title={row.url}
            >
              {host(row.url)}
            </div>
          ))}
        </div>
        <svg viewBox={`0 0 ${WIDTH} ${height}`} preserveAspectRatio="none" className="grow" style={{ height }}>
          {cut && (
            <rect x={x(cut.t)} y={0} width={WIDTH - x(cut.t)} height={height} fill="currentColor" fillOpacity={0.08}>
              <title>Not received by the selected condition</title>
            </rect>
          )}
          {rows.map((row, i) => {
            const open = row.first ?? 0;
            const end = row.end?.t ?? span;
            const color = row.end?.type === "EOSE" ? "text-success" : row.end ? "text-error" : "text-info";
            return (
              <g key={row.url} transform={`translate(0 ${i * LANE})`}>
                <line x1={0} x2={WIDTH} y1={LANE} y2={LANE} className="text-base-300" stroke="currentColor" />
                <rect
                  x={0}
                  y={LANE / 2 - 1}
                  width={x(end)}
                  height={2}
                  className="text-base-content"
                  fill="currentColor"
                  fillOpacity={0.15}
                />
                {bins(row.times).map((col) => (
                  <rect
                    key={col}
                    x={col}
                    y={6}
                    width={1}
                    height={LANE - 12}
                    className="text-base-content"
                    fill="currentColor"
                  />
                ))}
                {bins(row.lateTimes).map((col) => (
                  <rect
                    key={`l${col}`}
                    x={col}
                    y={6}
                    width={1}
                    height={LANE - 12}
                    className="text-warning"
                    fill="currentColor"
                  />
                ))}
                {row.first !== undefined && (
                  <rect x={x(open)} y={4} width={2} height={LANE - 8} className="text-info" fill="currentColor">
                    <title>First response at {fmt(row.first)}</title>
                  </rect>
                )}
                {row.end && (
                  <rect x={x(end) - 1} y={2} width={4} height={LANE - 4} className={color} fill="currentColor">
                    <title>
                      {row.end.type} at {fmt(row.end.t)} {row.end.reason ?? ""}
                    </title>
                  </rect>
                )}
              </g>
            );
          })}
          {settled !== undefined && (
            <line
              x1={x(settled)}
              x2={x(settled)}
              y1={0}
              y2={height}
              className="text-base-content"
              stroke="currentColor"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {marks.map((m) => (
            <line
              key={m.id}
              x1={x(m.t)}
              x2={x(m.t)}
              y1={0}
              y2={height}
              className={m.color}
              stroke="currentColor"
              strokeWidth={m.id === selected ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
      <div className="relative ml-48 h-6 border-t border-base-300 text-sm">
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute -translate-x-1/2 text-base-content/60"
            style={{ left: `${(t / span) * 100}%` }}
          >
            {t / 1000}s
          </span>
        ))}
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input
        type="number"
        className="input input-bordered w-full"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </label>
  );
}

export default function CompletionConditions() {
  const [relays, setRelays] = useState<string[]>(DEFAULT_RELAYS);
  const [picked, setPicked] = useState("");
  const [finding, setFinding] = useState(false);
  const [relayError, setRelayError] = useState("");
  const [filterJson, setFilterJson] = useState(JSON.stringify(FILTERS[0][1]));
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [selected, setSelected] = useState<ConditionId>("idle");
  const [run, setRun] = useState<Run>();

  const set = (key: keyof Settings) => (value: Settings[keyof Settings]) =>
    setSettings((s) => ({ ...s, [key]: value }));
  const filter = useMemo(() => {
    try {
      return JSON.parse(filterJson) as Filter;
    } catch {
      return undefined;
    }
  }, [filterJson]);

  // use$ owns the live REQ: starting a new run or clearing closes the previous subscription on every relay
  const snapshot = use$(() => (run ? race(run) : of(undefined)), [run]);

  const analysis = useMemo(
    () => (run && snapshot ? analyze(run.relays, snapshot.entries) : undefined),
    [run, snapshot],
  );

  const start = () => {
    if (!filter || !relays.length) return;
    // Use the pool's normalized URLs so they match the `from` field on messages
    setRun({ relays: relays.map((url) => pool.relay(url).url), filter, settings, id: Date.now() });
  };

  const findRelays = async () => {
    setFinding(true);
    setRelayError("");
    try {
      const events = await lastValueFrom(
        pool
          .relay("wss://relay.nostr.watch")
          .request({ kinds: [30166], limit: 200 }, { timeout: 10_000 })
          .pipe(toArray()),
      );
      setRelays(
        relaySet(events.flatMap((event) => getTagValue(event, "d") ?? []))
          .sort(() => Math.random() - 0.5)
          .slice(0, 10),
      );
    } catch (error) {
      setRelayError(String(error));
    } finally {
      setFinding(false);
    }
  };

  const elapsed = snapshot?.elapsed ?? 0;
  const total = analysis?.firstSeen.size ?? 0;
  const s = run?.settings ?? settings;

  const results = CONDITIONS.map((c) => {
    const fired = snapshot?.fired[c.id];
    const settled = analysis?.settled;
    let t: number | undefined;
    const error = snapshot?.errors[c.id];
    let by = snapshot?.done ? "request timeout (TimeoutError)" : "waiting…";
    // request() errors with whatever the condition throws
    if (error) by = `Error thrown by condition: ${error}`;
    else if (fired !== undefined && (settled === undefined || fired <= settled)) {
      t = fired;
      by = "condition";
    } else if (settled !== undefined) {
      t = settled;
      by = analysis?.allFailed ? "every relay failed (RelayGroupError)" : "every relay settled";
    } else if (snapshot?.done) t = s.timeout;

    const events = t === undefined ? 0 : [...(analysis?.firstSeen.values() ?? [])].filter((at) => at <= t).length;
    const waiting = t === undefined ? [] : (analysis?.rows ?? []).filter((r) => !r.end || r.end.t > t);
    return { ...c, t, fired, by, events, waiting };
  });

  const responded = analysis?.rows.filter((r) => r.first !== undefined).length ?? 0;
  const failed = analysis?.rows.filter((r) => r.end && r.end.type !== "EOSE").length ?? 0;
  const duplicates = analysis?.rows.reduce((n, r) => n + r.duplicates, 0) ?? 0;
  const lastNew = Math.max(0, ...(analysis?.firstSeen.values() ?? []));
  const span = Math.max(elapsed, 1000);
  const log = (snapshot?.entries ?? [])
    .filter((e) => e.type !== "EVENT")
    .map((e) => ({
      t: e.t,
      text: `${e.type} ${host(e.from)}${e.reason ? ` · ${e.reason}` : ""}${e.ignored ? ` (ignored ${e.ignored})` : ""}`,
    }))
    .concat(
      results.filter((r) => r.fired !== undefined).map((r) => ({ t: r.fired!, text: `${r.label} condition fired` })),
    )
    .concat(
      analysis?.settled !== undefined ? [{ t: analysis.settled, text: "Every relay settled (EOSE or failed)" }] : [],
    )
    .sort((a, b) => a.t - b.t);

  return (
    <div className="flex min-h-0 grow flex-col lg:flex-row">
      <aside className="shrink-0 space-y-4 overflow-y-auto border-b border-base-300 p-4 lg:w-80 lg:border-b-0 lg:border-r">
        <section className="space-y-2">
          <h2 className="font-semibold">Relays ({relays.length})</h2>
          <div className="flex gap-2">
            <RelayPicker value={picked} onChange={setPicked} className="flex-1" />
            <button
              className="btn"
              disabled={!picked || relays.includes(picked)}
              onClick={() => {
                setRelays(relaySet(relays, picked));
                setPicked("");
              }}
            >
              Add
            </button>
          </div>
          <ul className="border-y border-base-300 divide-y divide-base-300">
            {relays.map((url) => (
              <li key={url} className="flex items-center gap-2 py-1 text-sm">
                <span className="truncate flex-1 font-mono" title={url}>
                  {host(url)}
                </span>
                <button className="btn btn-ghost btn-sm" onClick={() => setRelays(relays.filter((r) => r !== url))}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button className="btn btn-sm" onClick={findRelays} disabled={finding}>
              {finding ? "Searching…" : "10 random relays"}
            </button>
            <button className="btn btn-sm" onClick={() => setRelays(DEFAULT_RELAYS)}>
              Defaults
            </button>
          </div>
          {relayError && <p className="text-sm text-error">{relayError}</p>}
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Filter</h2>
          <select
            className="select select-bordered w-full"
            value={FILTERS.find(([, f]) => JSON.stringify(f) === filterJson)?.[0] ?? ""}
            onChange={(e) => setFilterJson(JSON.stringify(FILTERS.find(([name]) => name === e.target.value)![1]))}
          >
            <option value="" disabled>
              Custom
            </option>
            {FILTERS.map(([name]) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <textarea
            className={`textarea textarea-bordered w-full font-mono text-sm ${filter ? "" : "textarea-error"}`}
            rows={2}
            value={filterJson}
            onChange={(e) => setFilterJson(e.target.value)}
          />
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold">Options (ms)</h2>
          <div className="grid grid-cols-2 gap-2">
            <NumberInput label="Idle grace" value={settings.grace} onChange={set("grace")} />
            <NumberInput label="Idle window" value={settings.idle} onChange={set("idle")} />
            <NumberInput label="Duplicate progress window" value={settings.progress} onChange={set("progress")} />
            <NumberInput label="Idle cap" value={settings.cap} onChange={set("cap")} />
            <NumberInput label="Fixed window" value={settings.window} onChange={set("window")} />
            <NumberInput label="Quorum (relays)" value={settings.quorum} onChange={set("quorum")} />
            <NumberInput label="Target (events)" value={settings.target} onChange={set("target")} />
            <label className="flex flex-col gap-1 text-sm">
              firstResponseTimeout
              <select
                className="select select-bordered w-full"
                value={String(settings.firstResponse)}
                onChange={(e) => set("firstResponse")(e.target.value === "false" ? false : Number(e.target.value))}
              >
                {([2_000, 5_000, 10_000, false] as const).map((v) => (
                  <option key={String(v)} value={String(v)}>
                    {v === false ? "off" : `${v / 1000}s`}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              timeout
              <select
                className="select select-bordered w-full"
                value={settings.timeout}
                onChange={(e) => set("timeout")(Number(e.target.value))}
              >
                {[15_000, 30_000, 60_000].map((v) => (
                  <option key={v} value={v}>
                    {v / 1000}s
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => setSettings(DEFAULTS)}>
            Reset to library defaults
          </button>
        </section>
      </aside>

      <div className="min-w-0 flex-1 space-y-6 overflow-y-auto p-4 md:p-6">
        <section className="space-y-3">
          <h2 className="text-2xl font-semibold">Request completion conditions</h2>
          <p>
            <code>pool.request()</code> fans one REQ out to every relay, then has to decide when it has heard enough.
            This sends a single live REQ and runs every condition against the same messages, so each row shows exactly
            what that request would have returned and how long it would have taken.
          </p>
          <p className="text-sm text-base-content/70">
            Every condition also completes when all relays have sent EOSE or failed, and a relay that stays silent past{" "}
            <code>firstResponseTimeout</code> counts as failed. Both rules match <code>request()</code>. Events a relay
            sends after it was failed are recorded but ignored.
          </p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={!filter || !relays.length} onClick={start}>
              {run && !snapshot?.done ? "Restart" : "Run request"}
            </button>
            <button className="btn btn-outline" disabled={!run} onClick={() => setRun(undefined)}>
              Stop & clear
            </button>
            <span className="ml-auto self-center" role="status">
              {!run ? "Ready" : snapshot?.done ? "Observation complete" : "Running"} · {fmt(elapsed)}
            </span>
          </div>
        </section>

        <div
          className="grid grid-cols-2 border-y border-base-300 divide-x divide-base-300 xl:grid-cols-5"
          aria-live="polite"
        >
          {[
            ["Relays responded", `${responded} / ${run?.relays.length ?? relays.length}`],
            ["Relays failed", failed],
            ["Unique events", total],
            ["Duplicate deliveries", duplicates],
            ["Last new event", fmt(total ? lastNew : undefined)],
          ].map(([label, value]) => (
            <div className="p-4" key={label}>
              <div className="text-sm text-base-content/70">{label}</div>
              <div className="mt-2 font-mono text-3xl">{value}</div>
            </div>
          ))}
        </div>

        {analysis && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Relay lanes</h3>
            <Lanes
              rows={analysis.rows}
              span={span}
              settled={analysis.settled}
              selected={selected}
              marks={results.filter((r) => r.t !== undefined).map((r) => ({ id: r.id, t: r.t!, color: r.color[0] }))}
            />
            <p className="text-sm text-base-content/70">
              Ticks are events · blue: first response · green: EOSE · red: failed · amber: ignored late events · dashed:
              every relay settled · colored lines: where each condition completes. The shaded area is what the selected
              condition never sees.
            </p>
          </section>
        )}

        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Conditions</h3>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Condition</th>
                  <th>Completes</th>
                  <th>Stopped by</th>
                  <th>Events</th>
                  <th>Coverage</th>
                  <th>Unfinished</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.id}
                    className={`cursor-pointer ${selected === r.id ? "bg-base-200" : "hover:bg-base-200"}`}
                    onClick={() => setSelected(r.id)}
                  >
                    <td>
                      <div className="flex items-center gap-2">
                        <span className={`size-3 shrink-0 rounded-full ${r.color[1]}`} />
                        <span className="font-semibold">{r.label}</span>
                        {"tag" in r && <span className="badge badge-outline">{r.tag}</span>}
                      </div>
                      <code className="text-sm text-base-content/70">{r.code(s)}</code>
                    </td>
                    <td className="font-mono">{fmt(r.t)}</td>
                    <td className={r.by.includes("Error") ? "text-error" : undefined}>{r.by}</td>
                    <td className="font-mono">{r.events}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <progress className="progress w-20" value={r.events} max={Math.max(total, 1)} />
                        <span className="font-mono text-sm">{total ? Math.round((r.events / total) * 100) : 0}%</span>
                      </div>
                    </td>
                    <td className="font-mono" title={r.waiting.map((w) => host(w.url)).join("\n")}>
                      {r.t === undefined ? "—" : `${r.waiting.length} / ${run?.relays.length ?? 0}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-base-content/70">
            Coverage compares against every unique event seen during the whole observation. <code>relaysFinished</code>{" "}
            and <code>uniqueEvents</code> are the custom operators defined at the top of this example.
          </p>
        </section>

        {analysis && (
          <section className="space-y-3">
            <h3 className="text-lg font-semibold">Relays</h3>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Relay</th>
                    <th>First response</th>
                    <th>Finished</th>
                    <th>Events</th>
                    <th>Duplicates</th>
                    <th>Only here</th>
                    <th>Late, ignored</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.rows.map((row) => (
                    <tr key={row.url}>
                      <td className="font-mono text-sm">{host(row.url)}</td>
                      <td className="font-mono">{fmt(row.first)}</td>
                      <td
                        className={row.end && row.end.type !== "EOSE" ? "text-error" : undefined}
                        title={row.end?.reason}
                      >
                        {row.end ? `${row.end.type} · ${fmt(row.end.t)}` : "streaming"}
                      </td>
                      <td className="font-mono">{row.events}</td>
                      <td className="font-mono">{row.duplicates}</td>
                      <td className="font-mono">{row.only}</td>
                      <td className={`font-mono ${row.late ? "text-warning" : ""}`}>{row.late}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {log.length > 0 && (
          <details className="border-y border-base-300 py-3">
            <summary className="cursor-pointer font-semibold">Lifecycle trace ({log.length})</summary>
            <div className="mt-3 max-h-64 overflow-auto font-mono text-sm" role="log">
              {log.map((entry, i) => (
                <div key={i} className="border-b border-base-300 py-1">
                  <span className="inline-block w-20 text-base-content/60">{fmt(entry.t)}</span>
                  {entry.text}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
