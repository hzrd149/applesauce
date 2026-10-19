/**
 * Watch OptimisticEventVerifier skip more signature checks as each relay earns trust, with evidence persisted in localForage
 * @tags relay, verification, signatures, trust, performance, localforage
 * @related relay/local-liveness, outbox/social-feed
 */
import { RelayDiscovery } from "applesauce-common/casts";
import { RELAY_DISCOVERY_KIND } from "applesauce-common/helpers";
import {
  castEvent,
  EventStore,
  mapEventsToStore,
  OptimisticEventVerifier,
  type OptimisticVerification,
} from "applesauce-core";
import { addSeenRelay, finalizeEvent, generateSecretKey, unixNow } from "applesauce-core/helpers";
import { RelayPool } from "applesauce-relay";
import { storeEvents } from "applesauce-relay/operators";
import { use$ } from "applesauce-react/hooks";
import localforage from "localforage";
import { useState } from "react";
import {
  bufferTime,
  catchError,
  defer,
  EMPTY as NONE,
  filter,
  ignoreElements,
  last,
  map,
  merge,
  NEVER,
  of,
  scan,
  shareReplay,
  startWith,
  tap,
  throttleTime,
  toArray,
} from "rxjs";

const PRESET_RELAYS = ["wss://relay.damus.io/", "wss://nos.lol/", "wss://relay.primal.net/", "wss://nostr.wine/"];
// nostr.watch's NIP-66 monitor and the relay it publishes relay reports to
const MONITOR_RELAY = "wss://relay.nostr.watch/";
const MONITOR = "9bbbb845e5b6c831c29789900769843ab43bb5047abe697870cb50b6fc9bf923";

// Demo-sized trust targets so the backoff is visible within minutes (library defaults need 10k checks over 14 days)
const OPTIONS = {
  minimumVerificationRate: 0.05,
  verifiedEventsForTrust: 500,
  daysForTrust: 1,
  verifiedEventsPerDay: 50,
};

// Relay evidence survives reloads in IndexedDB
const storage = localforage.createInstance({ name: "optimistic-verifier" });
const verifier = new OptimisticEventVerifier({ ...OPTIONS, historyDays: 7, storage });

// Every event added to the store goes through the optimistic verifier
const eventStore = new EventStore({ verifyEvent: verifier.verifyEvent });
const pool = new RelayPool();

// Monitor reports get their own fully verifying store so they don't count toward the stats below
const reportStore = new EventStore();

// Oldest event seen per relay so each pull pages further back
const cursors = new Map<string, number>();

type Result = OptimisticVerification["result"];
type Counts = Record<Result, number>;
const EMPTY: Counts = { verified: 0, skipped: 0, cached: 0, invalid: 0 };
const COLORS: Record<Result, string> = {
  verified: "bg-warning",
  skipped: "bg-success",
  cached: "bg-info",
  invalid: "bg-error",
};
const LABELS: Record<Result, string> = {
  verified: "Signature checked",
  skipped: "Accepted optimistically",
  cached: "Recently checked",
  invalid: "Rejected",
};

// Relays the monitor read from in the last two hours, without auth or payment. Fetched once and shared by every shuffle
const monitoredRelays$ = defer(() =>
  pool.relay(MONITOR_RELAY).request({ kinds: [RELAY_DISCOVERY_KIND], authors: [MONITOR], since: unixNow() - 2 * 3600 }),
).pipe(
  mapEventsToStore(reportStore),
  map((event) => castEvent(event, RelayDiscovery, reportStore)),
  filter(
    (r) =>
      r.rttRead !== undefined &&
      r.networkType === "clearnet" &&
      !r.requirements.some((q) => q === "auth" || q === "payment") &&
      // Skip relays that only accept other kinds, like NWC relays
      (r.acceptedKinds.length === 0 || r.acceptedKinds.includes("1")),
  ),
  map((r) => r.url),
  filter((url): url is string => !!url?.startsWith("wss://")),
  toArray(),
  map((urls) => [...new Set(urls)]),
  shareReplay(1),
);

/** Picks four random relays from the monitor's reports */
const randomRelays = () =>
  monitoredRelays$.pipe(
    map((urls) => [...urls].sort(() => Math.random() - 0.5).slice(0, 4)),
    catchError((error: Error) => of(error)),
  );

/** Opens one live subscription per relay so seen-relay provenance stays per relay */
function live(relays: string[]) {
  return merge(
    ...relays.map((url) =>
      pool
        .relay(url)
        .subscription({ kinds: [1], since: unixNow() })
        // A failing relay should not end the other subscriptions
        .pipe(
          storeEvents(eventStore),
          catchError(() => NONE),
        ),
    ),
  ).pipe(ignoreElements());
}

/** Pulls the next page of history from each relay and reports how many relays finished */
function pull(relays: string[]) {
  return merge(
    ...relays.map((url) =>
      pool
        .relay(url)
        .request({ kinds: [1], limit: 500, until: cursors.get(url) })
        .pipe(
          tap((e) => cursors.set(url, Math.min(cursors.get(url) ?? Infinity, e.created_at - 1))),
          storeEvents(eventStore),
          last(null, null),
          map(() => 1),
          catchError(() => of(1)),
        ),
    ),
  ).pipe(
    scan((done, n) => done + n, 0),
    map((done) => (done === relays.length ? "done" : `${done}/${relays.length} relays`)),
    startWith(`0/${relays.length} relays`),
  );
}

/** Counts outcomes and keeps the most recent results for a decision strip */
const tally = (source = verifier.verifications$) =>
  source.pipe(
    scan(
      (acc, v) => ({
        counts: { ...acc.counts, [v.result]: acc.counts[v.result] + 1 },
        recent: [v, ...acc.recent].slice(0, 120),
      }),
      { counts: EMPTY, recent: [] as OptimisticVerification[] },
    ),
    throttleTime(150, undefined, { leading: true, trailing: true }),
  );

// One-second buckets of outcomes over the last minute
const timeline$ = verifier.verifications$.pipe(
  bufferTime(1000),
  map((batch) => batch.reduce((c, v) => ({ ...c, [v.result]: c[v.result] + 1 }), EMPTY)),
  scan((buckets: Counts[], c) => [...buckets, c].slice(-60), []),
);

/** Forges an event "from" a relay: a broken id is always caught, a wrong signature only when sampled */
function forge(url: string, kind: "id" | "sig") {
  const event = finalizeEvent({ kind: 1, content: "forged", tags: [], created_at: unixNow() }, generateSecretKey());
  if (kind === "id") event.content = "tampered";
  else
    event.sig = finalizeEvent({ kind: 1, content: "other", tags: [], created_at: unixNow() }, generateSecretKey()).sig;
  addSeenRelay(event, url);
  eventStore.add(event);
}

const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;

function Strip({ results, size = "size-3" }: { results: OptimisticVerification[]; size?: string }) {
  return (
    <div className="flex flex-wrap gap-0.5">
      {results.map((v, i) => (
        <span
          key={`${v.event.id}-${i}`}
          title={`${LABELS[v.result]} · p=${pct(v.probability)}`}
          className={`${size} ${COLORS[v.result]}`}
        />
      ))}
    </div>
  );
}

/** The backoff curve p = rate^trust with a dot for every relay */
function Curve({ relays }: { relays: string[] }) {
  const states = use$(
    () =>
      merge(...relays.map((url) => verifier.relay$(url))).pipe(
        scan(
          (m, s) => ({ ...m, [s.relay]: s }),
          {} as Record<string, { trust: number; verificationProbability: number }>,
        ),
      ),
    [relays],
  );
  const W = 300,
    H = 140;
  const path = Array.from({ length: 51 }, (_, i) => {
    const t = i / 50;
    return `${i ? "L" : "M"}${t * W},${H - Math.pow(OPTIONS.minimumVerificationRate, t) * H}`;
  }).join(" ");

  return (
    <svg viewBox={`-10 -10 ${W + 20} ${H + 30}`} className="w-full max-w-sm border border-base-300">
      <path d={path} fill="none" stroke="currentColor" strokeOpacity={0.4} strokeWidth={2} />
      <text x={0} y={H + 16} fontSize={11} fill="currentColor">
        trust 0
      </text>
      <text x={W} y={H + 16} fontSize={11} fill="currentColor" textAnchor="end">
        trust 1
      </text>
      <text x={4} y={10} fontSize={11} fill="currentColor">
        check 100%
      </text>
      <text x={W - 4} y={H - 22} fontSize={11} fill="currentColor" textAnchor="end">
        check {pct(OPTIONS.minimumVerificationRate)}
      </text>
      {Object.values(states ?? {}).map((s, i) => (
        <circle key={i} cx={s.trust * W} cy={H - s.verificationProbability * H} r={6} fill="var(--color-success)" />
      ))}
    </svg>
  );
}

function RelayRow({ url }: { url: string }) {
  const state = use$(() => verifier.relay$(url), [url]);
  const session = use$(() => tally(verifier.verifications$.pipe(filter((v) => v.relays.includes(url)))), [url]);
  const counts = session?.counts ?? EMPTY;
  const trust = state?.trust ?? 0;

  return (
    <div className="border-b border-base-300 py-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <strong className="break-all">{url}</strong>
        {!state?.ready && <span className="loading loading-spinner loading-sm" />}
        <span className="ml-auto text-2xl tabular-nums" title="Chance the next new signature is checked">
          checks {pct(state?.verificationProbability ?? 1)}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <span className="w-14 text-sm">trust</span>
        <div className="relative h-4 grow border border-base-300">
          <div className="h-full bg-success transition-all" style={{ width: pct(trust) }} />
          {/* The first qualifying day unlocks the time requirement */}
          <div
            className="absolute inset-y-0 border-l-2 border-dashed border-warning"
            style={{ left: pct(OPTIONS.verifiedEventsPerDay / OPTIONS.verifiedEventsForTrust) }}
          />
        </div>
        <span className="w-28 text-sm tabular-nums text-right">
          {state?.verified ?? 0}/{OPTIONS.verifiedEventsForTrust}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
        {(Object.keys(EMPTY) as Result[]).map((r) => (
          <span key={r} className="flex items-center gap-1">
            <span className={`size-3 ${COLORS[r]}`} /> {counts[r]}
          </span>
        ))}
        <span className="flex items-end gap-0.5 h-5" title="Stored daily evidence">
          {state?.history.map((d) => (
            <span
              key={d.timestamp}
              className="w-2 bg-success"
              style={{ height: `${Math.max(10, Math.min(100, (d.verified / OPTIONS.verifiedEventsForTrust) * 100))}%` }}
            />
          ))}
        </span>
        <span className="ml-auto flex gap-2">
          <button
            className="btn btn-sm btn-outline btn-error"
            onClick={() => forge(url, "id")}
            title="Hash mismatch: always caught, wipes trust"
          >
            Forge id
          </button>
          <button
            className="btn btn-sm btn-outline btn-warning"
            onClick={() => forge(url, "sig")}
            title="Wrong signature: caught only if sampled"
          >
            Forge signature
          </button>
        </span>
      </div>

      <Strip results={session?.recent.slice(0, 80) ?? []} size="size-2" />
    </div>
  );
}

export default function OptimisticVerificationExample() {
  const [mode, setMode] = useState<"preset" | "random">("preset");
  const [shuffles, setShuffles] = useState(0);
  const [running, setRunning] = useState(false);
  const [pulls, setPulls] = useState(0);

  const random = use$(() => (mode === "random" ? randomRelays() : of(undefined)), [mode, shuffles]);
  const relays = mode === "preset" ? PRESET_RELAYS : Array.isArray(random) ? random : [];

  use$(() => (running ? live(relays) : NEVER), [running, relays]);
  const pullStatus = use$(() => (pulls ? pull(relays) : of(undefined)), [pulls, relays]);
  const session = use$(() => tally(), []);
  const timeline = use$(timeline$);

  const counts = session?.counts ?? EMPTY;
  const sampled = counts.verified + counts.skipped;
  const peak = Math.max(1, ...(timeline ?? []).map((b) => b.verified + b.skipped + b.cached + b.invalid));

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 min-w-0">
      <div className="flex flex-wrap gap-2 items-center">
        <div className="join">
          <button
            className={`btn join-item ${mode === "preset" ? "btn-active" : ""}`}
            onClick={() => (setMode("preset"), setPulls(0))}
          >
            Preset relays
          </button>
          <button
            className={`btn join-item ${mode === "random" ? "btn-active" : ""}`}
            onClick={() => (mode === "random" ? setShuffles(shuffles + 1) : setMode("random"), setPulls(0))}
          >
            {mode === "random" ? "Shuffle" : "Random relays"}
          </button>
        </div>
        <button className="btn btn-primary" onClick={() => setRunning(!running)}>
          {running ? "Stop live" : "Start live"}
        </button>
        <button
          className="btn btn-outline"
          disabled={!relays.length || (!!pullStatus && pullStatus !== "done")}
          onClick={() => setPulls(pulls + 1)}
        >
          {pullStatus && pullStatus !== "done" ? `Pulling ${pullStatus}` : "Pull 500 older per relay"}
        </button>
        <button
          className="btn btn-ghost ml-auto"
          onClick={async () => {
            await storage.clear();
            location.reload();
          }}
        >
          Reset stored trust
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto] border-y border-base-300 py-4">
        <div className="flex flex-col gap-3 min-w-0">
          <div className="flex flex-wrap gap-x-8 gap-y-2 items-end">
            <div>
              <div className="text-4xl tabular-nums">{sampled ? pct(counts.skipped / sampled) : "–"}</div>
              <div className="text-sm opacity-70">signature checks skipped</div>
            </div>
            {(Object.keys(EMPTY) as Result[]).map((r) => (
              <div key={r}>
                <div className="text-2xl tabular-nums flex items-center gap-2">
                  <span className={`size-4 ${COLORS[r]}`} />
                  {counts[r]}
                </div>
                <div className="text-sm opacity-70">{LABELS[r]}</div>
              </div>
            ))}
          </div>

          {/* Stacked outcomes per second: the green share shrinks as relays earn trust */}
          <div className="flex items-end gap-px h-32 border-b border-base-300">
            {timeline?.map((b, i) => (
              <div
                key={i}
                className="flex-1 flex flex-col-reverse"
                style={{ height: `${((b.verified + b.skipped + b.cached + b.invalid) / peak) * 100}%` }}
              >
                {(Object.keys(EMPTY) as Result[]).map((r) => (
                  <div key={r} className={COLORS[r]} style={{ flexGrow: b[r] }} />
                ))}
              </div>
            ))}
          </div>
          <div className="text-sm opacity-70">events per second, last 60s</div>

          <Strip results={session?.recent ?? []} />
        </div>

        <Curve relays={relays} />
      </div>

      <div>
        {mode === "random" && (
          <p className="text-sm opacity-70">
            {random === undefined
              ? "Loading relays from the nostr.watch monitor…"
              : random instanceof Error
                ? `Failed to load monitor reports: ${random.message}`
                : `Random picks from relays nostr.watch's monitor read from in the last two hours`}
          </p>
        )}
        {relays.map((url) => (
          <RelayRow key={url} url={url} />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <span>
          Full trust <strong>{OPTIONS.verifiedEventsForTrust} checks</strong>
        </span>
        <span>
          Qualifying day <strong>{OPTIONS.verifiedEventsPerDay} checks</strong>
        </span>
        <span>
          Floor <strong>{pct(OPTIONS.minimumVerificationRate)}</strong>
        </span>
        <span>
          Any bad event <strong>wipes the relay's trust</strong>
        </span>
      </div>
    </div>
  );
}

if (import.meta.hot) import.meta.hot.dispose(() => pool.close());
