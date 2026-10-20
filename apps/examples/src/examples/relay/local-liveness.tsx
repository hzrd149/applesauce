/**
 * Track relay health locally with RelayLiveness while live subscriptions skip relays in cooldown
 * @tags relay, liveness, network, subscriptions, backoff
 * @related relay/remote-monitor-liveness, outbox/relay-selection
 */
import { EventStore } from "applesauce-core";
import { normalizeRelayUrl, unixNow } from "applesauce-core/helpers";
import { combineLatestByValue } from "applesauce-core/observable";
import { RelayLiveness, RelayPool, type RelayState } from "applesauce-relay";
import { ignoreUnhealthyRelays, storeEvents } from "applesauce-relay/operators";
import { useState } from "react";
import {
  catchError,
  filter,
  ignoreElements,
  map,
  merge,
  NEVER,
  of,
  pairwise,
  scan,
  startWith,
  Subject,
  switchMap,
  timer,
} from "rxjs";
import { use$ } from "applesauce-react/hooks";
import { verifyEvent } from "../../extra/verifier";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io/",
  "wss://nos.lol/",
  "wss://relay.primal.net/",
  // An unreachable relay so the cooldown and dead states are visible
  "wss://offline.relay.invalid/",
];

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool({ keepAlive: 0, enablePing: true, pingFrequency: 15_000, pingTimeout: 15_000 });

// Short timings so state changes are visible within a minute
const liveness = new RelayLiveness({
  backoffBaseDelay: 5000,
  backoffMaxDelay: 30_000,
  maxFailuresBeforeDead: 4,
  minFailureDuration: 60_000,
  deadRetryDelay: 60_000,
});
liveness.connectToPool(pool);

// Manual retries restart a single relay's subscription
const retries$ = new Subject<string>();

/** Opens one subscription per eligible relay and reports each relay's request error */
function subscribeEligible(relays: string[]) {
  return of(relays).pipe(
    ignoreUnhealthyRelays(liveness),
    combineLatestByValue((url) =>
      retries$.pipe(
        filter((target) => target === url),
        startWith(url),
        switchMap(() =>
          pool.subscription([url], { kinds: [1], limit: 1, until: unixNow() }).pipe(
            storeEvents(eventStore),
            ignoreElements(),
            startWith(""),
            catchError((error: unknown) => {
              // Let the tracker classify request errors as reachability evidence
              liveness.recordRequestFailure(url, error);
              return of(String(error));
            }),
          ),
        ),
      ),
    ),
  );
}

type LogEntry = { time: number; url: string; message: string };

/** Records each relay's health transitions into a newest-first log */
function healthLog(relays: string[]) {
  return merge(
    ...relays.map((url) =>
      liveness.state(url).pipe(
        startWith(undefined),
        pairwise(),
        filter(([a, b]) => a?.state !== b?.state || a?.failureCount !== b?.failureCount),
        map(([, b]): LogEntry => ({ time: Date.now(), url, message: describe(b) })),
      ),
    ),
  ).pipe(scan((log: LogEntry[], entry) => [entry, ...log].slice(0, 100), []));
}

const failures = (count: number) => `${count} failure${count === 1 ? "" : "s"}`;

function describe(state?: RelayState) {
  if (!state) return "unknown";
  return state.failureCount ? `${state.state} · ${failures(state.failureCount)}` : state.state;
}

const stateColors: Record<string, string> = {
  online: "badge-success",
  offline: "badge-warning",
  dead: "badge-error",
};

function RelayRow({ url, error, eligible }: { url: string; error?: string; eligible: boolean }) {
  const state = use$(() => liveness.state(url), [url]);
  const connected = use$(() => pool.relay(url).connected$, [url]);
  // Tick while in cooldown so the remaining time counts down
  const now = use$(() => timer(0, 500).pipe(map(() => Date.now())), []);
  const remaining = Math.max(0, (state?.backoffUntil ?? 0) - (now ?? Date.now()));

  return (
    <tr>
      <td className="break-all">{url}</td>
      <td>
        <span className={`badge ${stateColors[state?.state ?? ""] ?? "badge-ghost"}`}>{state?.state ?? "unknown"}</span>
        {!!state?.failureCount && <span className="block text-sm mt-1">{failures(state.failureCount)}</span>}
      </td>
      <td>
        {eligible ? "Subscribed" : "Skipped"}
        <span className="block text-sm opacity-70">Socket {connected ? "open" : "closed"}</span>
        {error && <span className="block text-sm text-warning break-words">{error}</span>}
      </td>
      <td>{remaining > 0 ? `${(remaining / 1000).toFixed(1)}s` : "Ready"}</td>
      <td>
        <button
          className="btn btn-sm btn-outline"
          onClick={() => {
            const excluded = liveness.unhealthy.includes(url);
            liveness.reset(url);
            // Reset alone re-admits an excluded relay; an eligible one needs its subscription restarted
            if (!excluded) retries$.next(url);
          }}
        >
          Retry now
        </button>
      </td>
    </tr>
  );
}

export default function LocalRelayLiveness() {
  const [relays, setRelays] = useState(DEFAULT_RELAYS);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [networkAvailable, setNetworkAvailable] = useState(true);

  const outcomes = use$(() => (running ? subscribeEligible(relays) : NEVER), [running, relays]);
  const log = use$(() => (running ? healthLog(relays) : NEVER), [running, relays]);

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 min-w-0">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          try {
            const url = normalizeRelayUrl(input.trim());
            if (!relays.includes(url)) setRelays([...relays, url]);
            setInput("");
          } catch {}
        }}
      >
        <input
          className="input input-bordered grow"
          placeholder="wss://relay.example.com"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="btn btn-outline" type="submit">
          Add relay
        </button>
        <button className="btn btn-primary" type="button" onClick={() => setRunning(!running)}>
          {running ? "Stop subscriptions" : "Start subscriptions"}
        </button>
        <button
          className="btn btn-outline"
          type="button"
          onClick={() => {
            // Native apps forward platform connectivity; failures while offline are ignored
            liveness.setNetworkAvailable(!networkAvailable);
            setNetworkAvailable(!networkAvailable);
          }}
        >
          {networkAvailable ? "Simulate network loss" : "Restore network"}
        </button>
      </form>

      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Relay</th>
              <th>Local health</th>
              <th>Subscription</th>
              <th>Cooldown</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {relays.map((url) => (
              <RelayRow key={url} url={url} error={outcomes?.get(url)} eligible={outcomes?.has(url) ?? false} />
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="font-medium">Health transitions</h3>
      <ol className="border-y border-base-300 max-h-80 overflow-y-auto">
        {!running && <li className="p-2 opacity-70">Start the subscriptions to watch relay health change.</li>}
        {log?.map((entry, i) => (
          <li className="border-b border-base-300 p-2 text-sm break-words" key={`${entry.time}-${i}`}>
            <time className="mr-3 tabular-nums">{new Date(entry.time).toLocaleTimeString()}</time>
            <strong>{entry.url}</strong> · {entry.message}
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-base-300 pt-3 text-sm">
        <span>
          Cooldown <strong>5 → 10 → 20 → 30s</strong>
        </span>
        <span>
          Dead <strong>≥4 failures over 60s</strong>
        </span>
        <span>
          Dead retry <strong>60s</strong>
        </span>
        <span>
          Ping <strong>every 15s</strong>
        </span>
      </div>
    </div>
  );
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    pool.close();
    liveness.destroy();
  });
