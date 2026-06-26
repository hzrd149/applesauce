/**
 * Compare outbox relay selection with and without NIP-66 liveness filtering
 * @tags nip-65, nip-66, outbox, relay, liveness, debugging
 * @related outbox/relay-selection, relay-discovery/monitor-feed
 */
import { RelayDiscovery, RelayMonitor } from "applesauce-common/casts";
import { RELAY_DISCOVERY_KIND, RELAY_MONITOR_ANNOUNCEMENT_KIND, getRelayDiscoveryURL } from "applesauce-common/helpers";
import { castTimelineStream } from "applesauce-common/observable";
import { defined, EventStore, includeMailboxes, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import {
  classifyRelays,
  groupPubkeysByRelay,
  removeDeadRelays,
  selectOptimalRelays,
  unixNow,
} from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$, useObservableEagerState } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import type { ProfilePointer } from "nostr-tools/nip19";
import { useMemo, useState } from "react";
import { BehaviorSubject, map, shareReplay, switchMap, throttleTime } from "rxjs";

import PubkeyPicker from "../../components/pubkey-picker";
import RelayPicker from "../../components/relay-picker";

const DEFAULT_MONITOR = "9ba046db56b8e6682c48af8d6425ffe80430a3cd0854d95381af27c5d27ca0f7";
const DEFAULT_DISCOVERY_RELAY = "wss://relay.nostr.watch/";

const pubkey$ = new BehaviorSubject<string | null>(null);
const pool = new RelayPool();
const eventStore = new EventStore();

createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/", "wss://indexer.coracle.social/"],
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"],
});

const contacts$ = pubkey$.pipe(
  defined(),
  switchMap((pubkey) => eventStore.contacts(pubkey)),
);

function relaySet(users: ProfilePointer[]) {
  return new Set(users.flatMap((user) => user.relays ?? []));
}

function selectedRelays(users: ProfilePointer[]) {
  return Object.keys(groupPubkeysByRelay(users)).sort();
}

function overlap(a: Set<string>, b: Set<string>) {
  let count = 0;
  for (const value of a) if (b.has(value)) count++;
  return count;
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="border border-base-300 p-3">
      <div className="text-xs uppercase tracking-wide text-base-content/60">{label}</div>
      <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function RelayComparison({ relay, baseline, filtered }: { relay: string; baseline: Set<string>; filtered: Set<string> }) {
  const inBaseline = baseline.has(relay);
  const inFiltered = filtered.has(relay);

  return (
    <tr>
      <td className="font-mono text-xs break-all">{relay}</td>
      <td>{inBaseline ? <span className="badge badge-neutral">baseline</span> : null}</td>
      <td>{inFiltered ? <span className="badge badge-primary">filtered</span> : null}</td>
      <td>
        {inBaseline && !inFiltered ? <span className="badge badge-warning">removed</span> : null}
        {!inBaseline && inFiltered ? <span className="badge badge-info">added</span> : null}
        {inBaseline && inFiltered ? <span className="badge badge-success">kept</span> : null}
      </td>
    </tr>
  );
}

function MonitorOption({ monitor }: { monitor: RelayMonitor }) {
  const profile = use$(monitor.author.profile$);

  return (
    <option value={monitor.author.pubkey}>
      {profile?.displayName ?? monitor.author.pubkey.slice(0, 8) + "..."}
    </option>
  );
}

function MonitorPicker({
  monitors,
  onChange,
  value,
}: {
  monitors: RelayMonitor[];
  onChange: (monitor: string) => void;
  value: string;
}) {
  return (
    <select className="select select-bordered w-full" value={value} onChange={(e) => onChange(e.target.value)}>
      {monitors.map((monitor) => (
        <MonitorOption key={monitor.uid} monitor={monitor} />
      ))}
    </select>
  );
}

function RelayStatusBadge({ relay }: { relay: string }) {
  const connected = use$(() => pool.relay(relay).connected$, [relay]);
  return <div className={`badge ${connected ? "badge-success" : "badge-error"}`}>{relay}</div>;
}

export default function LivenessFilterExample() {
  const pubkey = useObservableEagerState(pubkey$);
  const [selectedMonitor, setSelectedMonitor] = useState(DEFAULT_MONITOR);
  const [discoveryRelay, setDiscoveryRelay] = useState(DEFAULT_DISCOVERY_RELAY);
  const [maxConnections, setMaxConnections] = useState(30);
  const [maxRelaysPerUser, setMaxRelaysPerUser] = useState(4);
  const [minAliveSetSize, setMinAliveSetSize] = useState(100);
  const [maxFilterRatio, setMaxFilterRatio] = useState(0.8);
  const [preserveOnion, setPreserveOnion] = useState(true);

  const contactsWithOutboxes$ = useMemo(
    () =>
      contacts$.pipe(
        includeMailboxes(eventStore),
        throttleTime(200),
        shareReplay(1),
      ),
    [],
  );

  const monitors =
    use$(
      () =>
        pool
          .relay(discoveryRelay)
          .subscription({ kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND] })
          .pipe(mapEventsToStore(eventStore), mapEventsToTimeline(), castTimelineStream(RelayMonitor, eventStore)),
      [discoveryRelay],
    ) ?? [];

  const monitor = useMemo(
    () => monitors.find((item) => item.author.pubkey === selectedMonitor),
    [monitors, selectedMonitor],
  );

  const monitorOutboxes = use$(monitor?.author.outboxes$);

  const discoveries =
    use$(
      () =>
        monitor
          ? pool
              .subscription(
                monitor.author.outboxes$.pipe(map((outboxes) => outboxes || [discoveryRelay])),
                { kinds: [RELAY_DISCOVERY_KIND], authors: [monitor.author.pubkey], since: unixNow() - 6 * 60 * 60 },
                { eventStore },
              )
              .pipe(mapEventsToStore(eventStore), mapEventsToTimeline(), castTimelineStream(RelayDiscovery, eventStore))
          : undefined,
      [monitor?.uid, discoveryRelay],
    ) ?? [];

  const original = use$(contactsWithOutboxes$) ?? [];

  const aliveRelays = useMemo(() => {
    const alive = new Set<string>();
    for (const discovery of discoveries) {
      const url = getRelayDiscoveryURL(discovery.event);
      if (url) alive.add(url);
    }
    return alive;
  }, [discoveries]);

  const filtered = useMemo(
    () =>
      removeDeadRelays(original, aliveRelays, {
        minAliveSetSize,
        maxFilterRatio,
        preserveOnion,
      }),
    [original, aliveRelays, minAliveSetSize, maxFilterRatio, preserveOnion],
  );

  const baselineSelection = useMemo(
    () => selectOptimalRelays(original, { maxConnections, maxRelaysPerUser }),
    [original, maxConnections, maxRelaysPerUser],
  );
  const filteredSelection = useMemo(
    () => selectOptimalRelays(filtered, { maxConnections, maxRelaysPerUser }),
    [filtered, maxConnections, maxRelaysPerUser],
  );

  const candidateRelays = relaySet(original);
  const afterFilterRelays = relaySet(filtered);
  const baselineSelected = new Set(selectedRelays(baselineSelection));
  const filteredSelected = new Set(selectedRelays(filteredSelection));
  const allSelected = Array.from(new Set([...baselineSelected, ...filteredSelected])).sort();

  const stats = useMemo(() => {
    let affectedUsers = 0;
    let protectedUsers = 0;
    let unmonitoredRelays = 0;

    for (const user of original) {
      const next = filtered.find((item) => item.pubkey === user.pubkey);
      const before = user.relays ?? [];
      const after = next?.relays ?? [];
      if (before.join("|") !== after.join("|")) affectedUsers++;

      if (aliveRelays.size >= minAliveSetSize && before.length > 0) {
        const classification = classifyRelays(before, aliveRelays, { preserveOnion });
        const kept = classification.alive.size + classification.unmonitored.length;
        const removedRatio = (before.length - kept) / before.length;
        if (removedRatio > maxFilterRatio) protectedUsers++;
        unmonitoredRelays += classification.unmonitored.length;
      }
    }

    return { affectedUsers, protectedUsers, unmonitoredRelays };
  }, [original, filtered, aliveRelays, minAliveSetSize, maxFilterRatio, preserveOnion]);

  return (
    <div className="min-h-screen p-4 space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold">NIP-66 Liveness Filter Debugger</h1>
        <p className="text-sm text-base-content/70 max-w-3xl">
          Compare normal outbox relay selection against selection after <code>removeDeadRelays</code>. If the alive set is
          too small, the guardrail keeps behavior unchanged.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="space-y-3">
          <PubkeyPicker value={pubkey || ""} onChange={(p) => pubkey$.next(p)} placeholder="Enter a pubkey..." />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <RelayPicker value={discoveryRelay} onChange={setDiscoveryRelay} />
            {monitors.length > 0 ? (
              <MonitorPicker monitors={monitors} onChange={setSelectedMonitor} value={selectedMonitor} />
            ) : (
              <div className="select select-bordered flex items-center text-sm text-base-content/60">
                Loading monitors...
              </div>
            )}
          </div>
          {monitorOutboxes && (
            <div className="flex gap-2 flex-wrap">
              {monitorOutboxes.map((outbox) => (
                <RelayStatusBadge key={outbox} relay={outbox} />
              ))}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="label-text">Max connections: {maxConnections}</span>
            <input
              type="range"
              min="1"
              max="100"
              value={maxConnections}
              onChange={(e) => setMaxConnections(Number(e.target.value))}
              className="range range-primary range-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="label-text">Max relays per user: {maxRelaysPerUser}</span>
            <input
              type="range"
              min="1"
              max="20"
              value={maxRelaysPerUser}
              onChange={(e) => setMaxRelaysPerUser(Number(e.target.value))}
              className="range range-primary range-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="label-text">Min alive set size: {minAliveSetSize}</span>
            <input
              type="range"
              min="0"
              max="500"
              step="10"
              value={minAliveSetSize}
              onChange={(e) => setMinAliveSetSize(Number(e.target.value))}
              className="range range-secondary range-sm"
            />
          </label>
          <label className="space-y-1">
            <span className="label-text">Max filter ratio: {maxFilterRatio.toFixed(2)}</span>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={maxFilterRatio}
              onChange={(e) => setMaxFilterRatio(Number(e.target.value))}
              className="range range-secondary range-sm"
            />
          </label>
          <label className="label cursor-pointer justify-start gap-3">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={preserveOnion}
              onChange={(e) => setPreserveOnion(e.target.checked)}
            />
            <span className="label-text">Preserve .onion / .i2p relays</span>
          </label>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Metric label="Contacts" value={original.length} />
        <Metric label="Candidate Relays" value={candidateRelays.size} />
        <Metric label="Alive Set" value={aliveRelays.size} tone={aliveRelays.size < minAliveSetSize ? "text-warning" : "text-success"} />
        <Metric label="After Filter" value={afterFilterRelays.size} />
        <Metric label="Removed" value={candidateRelays.size - afterFilterRelays.size} tone="text-warning" />
        <Metric label="Affected Users" value={stats.affectedUsers} />
        <Metric label="Protected Users" value={stats.protectedUsers} tone="text-info" />
        <Metric label="Selected Overlap" value={`${overlap(baselineSelected, filteredSelected)}/${baselineSelected.size}`} />
      </div>

      {aliveRelays.size < minAliveSetSize && (
        <div className="alert alert-warning">
          Alive set is below <code>minAliveSetSize</code>, so liveness filtering is currently a no-op.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="border border-base-300 p-4 space-y-2">
          <h2 className="text-xl font-semibold">Baseline Selection</h2>
          <div className="text-sm text-base-content/70">
            {baselineSelected.size} relays selected from {candidateRelays.size} candidates.
          </div>
        </div>
        <div className="border border-base-300 p-4 space-y-2">
          <h2 className="text-xl font-semibold">Filtered Selection</h2>
          <div className="text-sm text-base-content/70">
            {filteredSelected.size} relays selected after liveness filtering. {stats.unmonitoredRelays} unmonitored relay
            references were preserved.
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border border-base-300 max-h-[55vh] overflow-y-auto">
        <table className="table table-sm">
          <thead>
            <tr>
              <th>Relay</th>
              <th>Baseline</th>
              <th>Filtered</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {allSelected.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-10 text-base-content/60">
                  {pubkey ? "Loading contacts and monitor data..." : "Enter a pubkey to start."}
                </td>
              </tr>
            ) : (
              allSelected.map((relay) => (
                <RelayComparison key={relay} relay={relay} baseline={baselineSelected} filtered={filteredSelected} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
