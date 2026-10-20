/**
 * Route subscriptions around offline relays using NIP-66 monitor reports instead of probing relays locally
 * @tags relay, liveness, nip-66, monitor, routing, subscriptions
 * @related relay/local-liveness, relay-discovery/monitor-feed, relay-discovery/relay-directory
 */
import { castUser, RelayDiscovery, RelayMonitor, type User } from "applesauce-common/casts";
import { RELAY_MONITOR_ANNOUNCEMENT_KIND } from "applesauce-common/helpers";
import { castEvent, EventStore } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import { combineLatestByValue } from "applesauce-core/observable";
import {
  RemoteMonitorRelayLiveness,
  type Nip66RelayObservation,
  type Nip66RelayStatus,
} from "applesauce-extra/remote-monitor-relay-liveness";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { ignoreUnhealthyRelays, storeEvents } from "applesauce-relay/operators";
import { useMemo, useState } from "react";
import {
  auditTime,
  catchError,
  combineLatest,
  defer,
  finalize,
  map,
  NEVER,
  of,
  scan,
  startWith,
  timeout,
  toArray,
} from "rxjs";
import { relayTimeline } from "../../extra/relay-timeline";
import { lookupRelays$ } from "../../settings";

const MONITOR_RELAY = "wss://relay.nostr.watch/";
const DEFAULT_MONITORS = [
  "9ba046db56b8e6682c48af8d6425ffe80430a3cd0854d95381af27c5d27ca0f7",
  "9ba6484003e8e88600f97ebffd897b2fe82753082e8e0cd8ea19aac0ff2b712b",
];
const NOTE_FILTER = { kinds: [1], limit: 1 };

const eventStore = new EventStore();
// One pool reads monitor reports and opens the routed subscriptions; nothing probes relay health
const pool = new RelayPool({ keepAlive: 0 });
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Monitor announcements (kind 10166) published to the monitor relay
const monitors$ = relayTimeline(eventStore, pool, [MONITOR_RELAY], {
  kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND],
  limit: 40,
}).pipe(map((state) => state.events.map((event) => castEvent(event, RelayMonitor, eventStore))));

function age(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

/**
 * Standard NIP-66 reports have no explicit failure result, so this decoder reads failures from what monitors omit.
 * The library only calls it for fresh reports from trusted monitors and still requires a quorum before excluding.
 */
function judgeReport(report: RelayDiscovery): { state: Nip66RelayStatus; reason: string } {
  const announcement = eventStore.getReplaceable(RELAY_MONITOR_ANNOUNCEMENT_KIND, report.event.pubkey);
  const monitor = announcement && castEvent(announcement, RelayMonitor, eventStore);
  const frequency = monitor?.frequency || 3600;
  const since = unixNow() - report.event.created_at;

  // Monitors republish a report every round a relay passes; two missed rounds means it stopped answering
  if (since > frequency * 2) return { state: "offline", reason: `not confirmed for ${age(since * 1000)}` };
  if (report.rttRead !== undefined) return { state: "online", reason: `read in ${report.rttRead}ms` };
  // The monitor ran a read check and only recorded the connection opening
  if (report.rttOpen !== undefined && monitor?.checks.includes("read"))
    return { state: "offline", reason: "connects but fails reads" };
  return { state: "unknown", reason: "no read check" };
}

/** Creates a liveness source for the selected monitors and destroys it when the selection changes */
function monitorLiveness(monitors: string[]) {
  return defer(() => {
    const health = new RemoteMonitorRelayLiveness(eventStore, {
      monitors: monitors.map((pubkey) => ({
        pubkey,
        relays: [MONITOR_RELAY],
        interpretReport: (report) => judgeReport(report).state,
      })),
      // Keep reports until the monitor's announced frequency expires them (three rounds)
      maxAge: 2 * 24 * 3600_000,
      limit: 5000,
    });
    health.connectToPool(pool);

    return combineLatest({ online: health.online$, unhealthy: health.unhealthy$, errors: health.errors$ }).pipe(
      auditTime(250),
      map((state) => ({ ...state, health })),
      finalize(() => health.destroy()),
    );
  });
}

type Outcome = { status: "connecting" | "live" | "failed"; events: number; error?: string };

/** Subscribes to every relay the monitors have not excluded, dropping relays as soon as they become unhealthy */
function routeSubscriptions(health: RemoteMonitorRelayLiveness, relays: string[]) {
  return of(relays).pipe(
    ignoreUnhealthyRelays(health),
    combineLatestByValue((url) =>
      pool
        .relay(url)
        .subscription(NOTE_FILTER, { reconnect: 0 })
        .pipe(
          storeEvents(eventStore),
          scan(
            (state: Outcome, message): Outcome =>
              message === "EOSE" ? { ...state, status: "live" } : { ...state, events: state.events + 1 },
            { status: "connecting", events: 0 },
          ),
          startWith<Outcome>({ status: "connecting", events: 0 }),
          catchError((error: unknown) => of<Outcome>({ status: "failed", events: 0, error: String(error) })),
        ),
    ),
  );
}

/** Makes one direct request so an avoided relay can be compared with the monitors' verdict */
function checkDirectly(url: string) {
  return pool
    .relay(url)
    .request(NOTE_FILTER, { reconnect: 0 })
    .pipe(
      toArray(),
      timeout(15_000),
      map(() => "Answered a direct request"),
      catchError((error: unknown) => of(`Direct request failed: ${error instanceof Error ? error.message : error}`)),
      startWith("Checking…"),
    );
}

function MonitorName({ user }: { user: User }) {
  const profile = use$(user.profile$);
  return <>{profile?.displayName || `${user.npub.slice(0, 12)}…`}</>;
}

function Observation({ observation }: { observation: Nip66RelayObservation }) {
  const user = useMemo(() => castUser(observation.monitor, eventStore), [observation.monitor]);
  const event = eventStore.getEvent(observation.eventId);
  const reason = event ? judgeReport(castEvent(event, RelayDiscovery, eventStore)).reason : observation.state;
  return (
    <li>
      <MonitorName user={user} />: {reason}
    </li>
  );
}

const stateColors: Record<string, string> = { online: "badge-success", offline: "badge-error", unknown: "badge-ghost" };

function RouteRow({ url, health, outcome }: { url: string; health: RemoteMonitorRelayLiveness; outcome?: Outcome }) {
  const state = use$(() => health.state(url), [health, url]);
  const [checking, setChecking] = useState(false);
  const check = use$(() => (checking ? checkDirectly(url) : NEVER), [checking, url]);

  return (
    <tr>
      <td className="break-all">{url}</td>
      <td>
        <span className={`badge ${stateColors[state?.state ?? "unknown"]}`}>{state?.state ?? "unknown"}</span>
        <ul className="text-sm mt-1">
          {state?.observations.map((observation) => (
            <Observation key={observation.eventId} observation={observation} />
          ))}
        </ul>
      </td>
      <td>
        {outcome ? (
          <>
            <span className="text-success">Subscribed</span>
            <span className="block text-sm">
              {outcome.status === "failed"
                ? outcome.error
                : outcome.status === "live"
                  ? `EOSE · ${outcome.events} events`
                  : "Connecting…"}
            </span>
          </>
        ) : (
          <>
            <span className="text-error">Avoided</span>
            {check ? (
              <span className="block text-sm">{check}</span>
            ) : (
              <button className="btn btn-sm btn-outline mt-1 block" onClick={() => setChecking(true)}>
                Check directly
              </button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

/** Picks a mix of relays the monitors confirm and relays they report as failing */
function sampleRoute(online: string[], unhealthy: string[]) {
  const pick = (list: string[]) => [...list].sort(() => Math.random() - 0.5).slice(0, 6);
  return [...pick(online), ...pick(unhealthy)].sort();
}

export default function RemoteMonitorLiveness() {
  const [selected, setSelected] = useState(DEFAULT_MONITORS);
  const [route, setRoute] = useState<string[] | null>(null);
  const monitors = use$(monitors$);
  const live = use$(() => (selected.length ? monitorLiveness(selected) : NEVER), [selected]);
  const health = live?.health;
  const outcomes = use$(() => (health && route ? routeSubscriptions(health, route) : NEVER), [health, route]);

  // Keep the selected monitors visible even when their announcement has not loaded
  const options = useMemo(() => {
    const frequencies = new Map(monitors?.map((m) => [m.event.pubkey, m.frequency]));
    return [...new Set([...selected, ...frequencies.keys()])].map((pubkey) => ({
      user: castUser(pubkey, eventStore),
      frequency: frequencies.get(pubkey),
    }));
  }, [monitors, selected]);

  const toggle = (pubkey: string) => {
    setRoute(null);
    setSelected(selected.includes(pubkey) ? selected.filter((p) => p !== pubkey) : [...selected, pubkey]);
  };

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6 min-w-0">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Trusted monitors (pick up to two)</h2>
        {!monitors && <p>Loading monitors from {MONITOR_RELAY}…</p>}
        <div className="flex flex-wrap gap-2">
          {options.map(({ user, frequency }) => (
            <label key={user.pubkey} className="flex items-center gap-2 border border-base-300 rounded p-2">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={selected.includes(user.pubkey)}
                disabled={!selected.includes(user.pubkey) && selected.length >= 2}
                onChange={() => toggle(user.pubkey)}
              />
              <MonitorName user={user} />
              {frequency && <span className="text-sm opacity-70">every {age(frequency * 1000)}</span>}
            </label>
          ))}
        </div>
      </section>

      {live &&
        Object.entries(live.errors).map(([pubkey, error]) => (
          <p key={pubkey} className="text-warning">
            Monitor {pubkey.slice(0, 8)}: {error}
          </p>
        ))}

      {selected.length === 0 ? (
        <p>Select a monitor to load its relay reports.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y border-base-300 py-3">
          <span className="text-success">
            Confirmed online <strong>{live?.online.length ?? 0}</strong>
          </span>
          <span className="text-error">
            Excluded <strong>{live?.unhealthy.length ?? 0}</strong>
          </span>
          <button
            className="btn btn-primary ml-auto"
            disabled={!live || live.online.length + live.unhealthy.length === 0}
            onClick={() => live && setRoute(sampleRoute(live.online, live.unhealthy))}
          >
            {route ? "Pick new relays" : "Route subscriptions"}
          </button>
          {route && (
            <button className="btn btn-outline" onClick={() => setRoute(null)}>
              Stop
            </button>
          )}
        </div>
      )}

      {route && health && (
        <>
          <p className="text-sm opacity-70">
            {route.length} relays passed through <code>ignoreUnhealthyRelays(health)</code>: {outcomes?.size ?? 0}{" "}
            subscribed, {route.length - (outcomes?.size ?? 0)} avoided. With two monitors both must report a failure
            before a relay is excluded.
          </p>
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Relay</th>
                  <th>Monitor verdict</th>
                  <th>Routing</th>
                </tr>
              </thead>
              <tbody>
                {route.map((url) => (
                  <RouteRow key={url} url={url} health={health} outcome={outcomes?.get(url)} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

if (import.meta.hot) import.meta.hot.dispose(() => pool.close());
