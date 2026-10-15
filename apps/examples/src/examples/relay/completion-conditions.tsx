/**
 * Compare naive completion conditions, the legacy fixed grace window, and the idle-aware default used by pool.request
 * @tags relay, pool, request, completion, eose, performance
 * @related feed/relay-timeline, outbox/relay-selection
 */
import {
  Observable,
  defer,
  takeUntil,
  takeLast,
  defaultIfEmpty,
  catchError,
  of,
  materialize,
  startWith,
  last,
  map,
  merge,
  filter as rxFilter,
  scan,
  shareReplay,
  take,
  timer,
} from "rxjs";

import { mapEventsToTimeline } from "applesauce-core";
import { getTagValue, NostrEvent, relaySet, Filter } from "applesauce-core/helpers";
import { use$ } from "applesauce-react/hooks";
import { RelayGroup, RelayPool } from "applesauce-relay";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import { completeWhen } from "applesauce-relay/operators/complete-when";
import { GroupReqMessage } from "applesauce-relay/types";
import { useCallback, useMemo, useState } from "react";

import RelayPicker from "../../components/relay-picker";

// Create a relay pool instance
const pool = new RelayPool({
  informationCache: new Keyv({ store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "nip11" }) }),
});

// Types for tracking completion conditions
type TimelineMessage = GroupReqMessage & {
  timestamp: number; // ms since query start
  deltaTime: number; // ms since last message from this relay
};

interface CompletionMarker {
  type: "firstEose" | "fixedGrace" | "idleAware" | "allComplete" | "firstNRelays" | "eventCount" | "timeLimit";
  time: number; // when it triggered
  eventCount: number; // events received at that point
  label: string; // display name
  explanation: string; // why it completed
  color: string; // tailwind background class
  border: string; // tailwind border class, written out so Tailwind generates it
}

const MESSAGE_STYLES = {
  OPEN: "badge-info",
  EVENT: "badge-success",
  EOSE: "badge-warning",
  ERROR: "badge-error",
  CLOSED: "badge-neutral",
  RELAYS: "badge-accent",
};

type RelayState = "PENDING" | "OPEN" | "EOSE" | "CLOSED" | "ERROR";

const STATE_STYLES: Record<RelayState, string> = {
  PENDING: "badge-ghost",
  OPEN: "badge-info",
  EOSE: "badge-success",
  CLOSED: "badge-neutral",
  ERROR: "badge-error",
};

function RelayBadge({ relay, state }: { relay: string; state: RelayState }) {
  const icon = use$(() => pool.relay(relay).icon$, [relay]);
  const name = use$(() => pool.relay(relay).name$, [relay]);

  return (
    <div className={`badge gap-1.5 ${STATE_STYLES[state]}`}>
      <img src={icon} alt="" className="w-4 h-4 rounded-sm" onError={(e) => (e.currentTarget.style.display = "none")} />
      <span className="font-mono text-sm">{name}</span>
      <span className="text-sm opacity-70">{state}</span>
    </div>
  );
}

export default function CompletionConditions() {
  const [relays, setRelays] = useState<string[]>(() =>
    relaySet([
      "wss://relay.damus.io",
      "wss://relay.snort.social",
      "wss://nos.lol",
      "wss://relay.primal.net",
      "wss://nostr.wine",
      "wss://nostr-pub.wellorder.net",
      "wss://relay.nostr.band", // Intentionally add dead relay
    ]),
  );

  const [currentRelay, setCurrentRelay] = useState("");

  // Contact lists are large, so relays keep streaming long enough to show the difference between policies
  const [filterJson, setFilterJson] = useState('{"kinds":[3],"limit":200}');

  const [filterError, setFilterError] = useState<string | null>(null);

  // Completion configuration
  const [eventCountThreshold, setEventCountThreshold] = useState(20);

  const [firstEoseTimeout, setFirstEoseTimeout] = useState(5000);

  const [grace, setGrace] = useState(3000);

  const [idle, setIdle] = useState(1500);

  const [cap, setCap] = useState(15000);

  const [firstNRelaysCount, setFirstNRelaysCount] = useState(2);

  const [timeLimitMs, setTimeLimitMs] = useState(20000);

  const [config, setConfig] = useState<{
    relays: string[];
    filter: Filter;
    eventCountThreshold: number;
    firstEoseTimeout: number;
    grace: number;
    idle: number;
    cap: number;
    firstNRelaysCount: number;
    timeLimitMs: number;
  } | null>(null);
  const queryState = use$(() => {
    const initial = {
      timelineMessages: [] as TimelineMessage[],
      completionMarkers: [] as CompletionMarker[],
      events: [] as NostrEvent[],
      querying: false,
      error: "",
    };
    if (!config) return of(initial);
    return defer(() => {
      const started = Date.now();
      const last = new Map<string, number>();
      const messages$ = pool
        .group(config.relays)
        .req(config.filter)
        .pipe(
          takeUntil(timer(config.timeLimitMs)),
          map((message) => {
            const timestamp = Date.now() - started;
            const deltaTime = timestamp - (last.get(message.from) ?? 0);
            last.set(message.from, timestamp);
            return { ...message, timestamp, deltaTime } as TimelineMessage;
          }),
          shareReplay({ bufferSize: 100, refCount: true }),
        );
      const marker = (
        type: CompletionMarker["type"],
        label: string,
        [color, border]: [string, string],
        condition: Observable<GroupReqMessage>,
        explanation: string,
      ) =>
        condition.pipe(
          scan(
            (seen, message) => (message.type === "EVENT" ? new Set([...seen, message.event.id]) : seen),
            new Set<string>(),
          ),
          takeLast(1),
          defaultIfEmpty(new Set<string>()),
          map((seen) => ({
            marker: {
              type,
              label,
              color,
              border,
              explanation,
              eventCount: seen.size,
              time: Date.now() - started,
            } as CompletionMarker,
          })),
        );
      const firstEose$ = messages$.pipe(
        completeWhen((source) =>
          source.pipe(
            rxFilter((message) => message.type === "EOSE"),
            take(1),
            map(() => true),
          ),
        ),
      );
      const eventCount$ = messages$.pipe(
        completeWhen((source) =>
          source.pipe(
            rxFilter((message) => message.type === "EVENT"),
            scan((count) => count + 1, 0),
            rxFilter((count) => count >= config.eventCountThreshold),
            take(1),
            map(() => true),
          ),
        ),
      );
      const firstN$ = messages$.pipe(
        completeWhen((source) =>
          source.pipe(
            rxFilter((message) => message.type === "EOSE"),
            scan((seen, message) => new Set([...seen, message.from]), new Set<string>()),
            rxFilter((seen) => seen.size >= config.firstNRelaysCount),
            take(1),
            map(() => true),
          ),
        ),
      );
      const items$ = merge(
        messages$.pipe(map((message) => ({ message }))),
        marker(
          "firstEose",
          "First EOSE",
          ["bg-yellow-500", "border-yellow-500"],
          firstEose$,
          "First EOSE or request time limit",
        ),
        marker(
          "eventCount",
          "Event Count",
          ["bg-blue-500", "border-blue-500"],
          eventCount$,
          "Event threshold or request time limit",
        ),
        marker(
          "firstNRelays",
          "First N Relays",
          ["bg-green-500", "border-green-500"],
          firstN$,
          "Relay threshold or request time limit",
        ),
        marker(
          "fixedGrace",
          "Fixed grace (legacy)",
          ["bg-orange-500", "border-orange-500"],
          messages$.pipe(completeWhen(RelayGroup.completeAfterFirstRelay(config.firstEoseTimeout))),
          "Fixed window after the first EOSE, even if relays are still sending events",
        ),
        marker(
          "idleAware",
          "Idle-aware (default)",
          ["bg-teal-500", "border-teal-500"],
          messages$.pipe(
            completeWhen(RelayGroup.completeAfterIdle({ grace: config.grace, idle: config.idle, cap: config.cap })),
          ),
          "Waits the grace period for silent relays, keeps waiting while events flow, stops at the cap",
        ),
        marker(
          "allComplete",
          "All Complete",
          ["bg-purple-500", "border-purple-500"],
          messages$.pipe(completeWhen(RelayGroup.completeOnAllEose())),
          "All relays finished or request time limit",
        ),
        marker("timeLimit", "Time Limit", ["bg-red-500", "border-red-500"], messages$, "Overall request time limit"),
      );
      return items$.pipe(
        scan(
          (state, item) => {
            if ("marker" in item) return { ...state, completionMarkers: [...state.completionMarkers, item.marker] };
            const message = item.message;
            const events =
              message.type === "EVENT" && !state.events.some((event) => event.id === message.event.id)
                ? [...state.events, message.event]
                : state.events;
            return { ...state, timelineMessages: [...state.timelineMessages, message], events };
          },
          { ...initial, querying: true },
        ),
        materialize(),
        scan(
          (state, notification) =>
            notification.kind === "N"
              ? notification.value
              : { ...state, querying: false, error: notification.kind === "E" ? String(notification.error) : "" },
          { ...initial, querying: true },
        ),
        startWith({ ...initial, querying: true }),
      );
    });
  }, [config]);
  const timelineMessages = queryState?.timelineMessages ?? [];
  const completionMarkers = queryState?.completionMarkers ?? [];
  const events = queryState?.events ?? [];
  const isQuerying = queryState?.querying ?? false;

  // Get pool status
  const poolStatuses = use$(pool.status$);

  const relayStates = useMemo(() => {
    const states = new Map<string, RelayState>();
    for (const relay of relays) {
      states.set(relay, "PENDING");
    }
    for (const msg of timelineMessages) {
      if (msg.type === "OPEN" || msg.type === "EOSE" || msg.type === "CLOSED" || msg.type === "ERROR") {
        states.set(msg.from, msg.type);
      }
    }
    return states;
  }, [relays, timelineMessages]);

  // Validate filter JSON
  const validateFilter = useCallback((json: string) => {
    try {
      JSON.parse(json);
      setFilterError(null);
      return true;
    } catch (e) {
      setFilterError("Invalid JSON");
      return false;
    }
  }, []);

  // Add relay to list
  const handleAddRelay = useCallback(() => {
    if (currentRelay && !relays.includes(currentRelay)) {
      setRelays([...relays, currentRelay]);
      setCurrentRelay("");
    }
  }, [currentRelay, relays]);

  // Remove relay from list
  const handleRemoveRelay = useCallback(
    (relay: string) => {
      setRelays(relays.filter((r) => r !== relay));
    },
    [relays],
  );

  const [attempt, setAttempt] = useState(0);
  const randomRelays = use$(
    () =>
      attempt
        ? pool
            .relay("wss://relay.nostr.watch")
            .request({ kinds: [30166], limit: 200 }, { timeout: 10_000 })
            .pipe(
              mapEventsToTimeline(),
              last(),
              map((events) => ({
                loading: false,
                relays: relaySet(events.map((event) => getTagValue(event, "d")).filter((value) => value !== undefined))
                  .sort(() => Math.random() - 0.5)
                  .slice(0, 10),
                error: "",
              })),
              startWith({ loading: true, relays: [] as string[], error: "" }),
              catchError((error) => of({ loading: false, relays: [] as string[], error: String(error) })),
            )
        : of({ loading: false, relays: [] as string[], error: "" }),
    [attempt],
  );
  const handleRandomRelays = () => setAttempt((attempt) => attempt + 1);
  const handleUseRandomRelays = () => {
    if (randomRelays?.relays.length) setRelays(randomRelays.relays);
  };
  const handleReset = () => setConfig(null);
  const handleQuery = () => {
    if (!validateFilter(filterJson) || !relays.length) return;
    setConfig({
      relays,
      filter: JSON.parse(filterJson),
      eventCountThreshold,
      firstEoseTimeout,
      grace,
      idle,
      cap,
      firstNRelaysCount,
      timeLimitMs,
    });
  };

  // Format time display
  const formatTime = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  return (
    <div className="container mx-auto p-4 space-y-6">
      {queryState?.error && (
        <p className="text-error" role="alert">
          {queryState.error}
        </p>
      )}
      {randomRelays?.error && (
        <p className="text-error" role="alert">
          {randomRelays.error}
        </p>
      )}
      {!!randomRelays?.relays.length && (
        <button className="btn" onClick={handleUseRandomRelays}>
          Use discovered relays
        </button>
      )}
      {/* Controls */}
      <div className="border border-base-300 bg-base-200">
        <div className="p-4 space-y-4">
          {/* Relay Management */}
          <div>
            <label className="label">
              <span className="label-text font-semibold">Relays ({relays.length})</span>
            </label>
            <div className="flex gap-2 mb-2">
              <RelayPicker value={currentRelay} onChange={(next: string) => setCurrentRelay(next)} className="flex-1" />
              <button
                className="btn btn-primary"
                onClick={handleAddRelay}
                disabled={!currentRelay || relays.includes(currentRelay)}
              >
                Add Relay
              </button>
              <button className="btn btn-secondary" onClick={handleRandomRelays} disabled={randomRelays?.loading}>
                {randomRelays?.loading ? "Loading..." : "Find random relays"}
              </button>
            </div>
            {relays.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {relays.map((relay) => (
                  <div key={relay} className="badge badge-lg gap-2">
                    <span className="font-mono">{relay}</span>
                    <button className="btn btn-ghost btn-sm btn-circle" onClick={() => handleRemoveRelay(relay)}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Filter Configuration */}
          <div>
            <label className="label">
              <span className="label-text font-semibold">Filter (JSON)</span>
              {filterError && <span className="label-text-alt text-error">{filterError}</span>}
            </label>
            <textarea
              className={`textarea textarea-bordered w-full font-mono text-sm ${filterError ? "textarea-error" : ""}`}
              rows={3}
              value={filterJson}
              onChange={(e) => {
                setFilterJson(e.target.value);
                validateFilter(e.target.value);
              }}
            />
          </div>

          {/* Completion Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Event Count Threshold: {eventCountThreshold}</span>
              </label>
              <input
                type="range"
                min="5"
                max="50"
                value={eventCountThreshold}
                onChange={(e) => setEventCountThreshold(Number(e.target.value))}
                className="range range-sm"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Legacy grace window: {formatTime(firstEoseTimeout)}</span>
              </label>
              <input
                type="range"
                min="100"
                max="10000"
                step="100"
                value={firstEoseTimeout}
                onChange={(e) => setFirstEoseTimeout(Number(e.target.value))}
                className="range range-sm"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Idle-aware grace: {formatTime(grace)}</span>
              </label>
              <input
                type="range"
                min="100"
                max="10000"
                step="100"
                value={grace}
                onChange={(e) => setGrace(Number(e.target.value))}
                className="range range-sm"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Idle-aware idle window: {formatTime(idle)}</span>
              </label>
              <input
                type="range"
                min="100"
                max="5000"
                step="100"
                value={idle}
                onChange={(e) => setIdle(Number(e.target.value))}
                className="range range-sm"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Idle-aware cap: {formatTime(cap)}</span>
              </label>
              <input
                type="range"
                min="1000"
                max="30000"
                step="100"
                value={cap}
                onChange={(e) => setCap(Number(e.target.value))}
                className="range range-sm"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">First N Relays: {firstNRelaysCount}</span>
              </label>
              <input
                type="range"
                min="1"
                max={Math.max(relays.length, 5)}
                value={Math.min(firstNRelaysCount, relays.length)}
                onChange={(e) => setFirstNRelaysCount(Number(e.target.value))}
                className="range range-sm"
                disabled={relays.length === 0}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="label">
                <span className="label-text">Time Limit: {formatTime(timeLimitMs)}</span>
              </label>
              <input
                type="range"
                min="100"
                max="30000"
                step="100"
                value={timeLimitMs}
                onChange={(e) => setTimeLimitMs(Number(e.target.value))}
                className="range range-sm"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              className="btn btn-primary"
              onClick={handleQuery}
              disabled={isQuerying || relays.length === 0 || !!filterError}
            >
              {isQuerying ? "Querying..." : "Start Query"}
            </button>
            <button className="btn" onClick={handleReset} disabled={timelineMessages.length === 0 && !isQuerying}>
              Reset
            </button>
            {poolStatuses && Object.keys(poolStatuses).length > 0 && (
              <div className="badge badge-lg ml-auto">
                Connected: {Object.values(poolStatuses).filter((s) => s.ready).length}/
                {Object.keys(poolStatuses).length}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Completion Summary */}
      {completionMarkers.length > 0 && (
        <div className="border border-base-300 bg-base-100">
          <div className="p-4">
            <h2 className="font-semibold">Completion Summary</h2>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Trigger Time</th>
                    <th>Events Received</th>
                    <th>Coverage</th>
                    <th>Speed</th>
                  </tr>
                </thead>
                <tbody>
                  {completionMarkers
                    .slice()
                    .sort((a, b) => a.time - b.time)
                    .map((marker, idx) => {
                      const totalEvents = events.length;
                      const coverage = totalEvents > 0 ? ((marker.eventCount / totalEvents) * 100).toFixed(0) : "0";
                      const speeds = ["Fastest", "Fast", "Medium", "Slow", "Slower", "Slowest"];
                      const speed = speeds[Math.min(idx, speeds.length - 1)];

                      return (
                        <tr key={marker.type}>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className={`w-3 h-3 rounded-full ${marker.color}`}></div>
                              <span className="font-semibold">{marker.label}</span>
                            </div>
                          </td>
                          <td className="font-mono">{formatTime(marker.time)}</td>
                          <td>{marker.eventCount}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <progress
                                className="progress progress-primary w-20"
                                value={coverage}
                                max="100"
                              ></progress>
                              <span className="text-sm">{coverage}%</span>
                            </div>
                          </td>
                          <td>
                            <div className="badge badge-outline">{speed}</div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      {timelineMessages.length > 0 && (
        <div className="border border-base-300 bg-base-100">
          <div className="p-4">
            <h2 className="font-semibold">Message Timeline</h2>
            <div className="flex flex-wrap gap-2">
              {relays.map((relay) => (
                <RelayBadge key={relay} relay={relay} state={relayStates.get(relay) || "PENDING"} />
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Relay</th>
                    <th>Type</th>
                    <th>Details</th>
                    <th>Δ Time</th>
                  </tr>
                </thead>
                <tbody>
                  {timelineMessages.map((msg, idx) => {
                    const msgType = msg.type as keyof typeof MESSAGE_STYLES;

                    // Get details based on message type
                    let details = "";
                    if (msg.type === "EVENT") {
                      details = msg.event.id.substring(0, 8);
                    } else if (msg.type === "OPEN") {
                      details = msg.from;
                    }

                    // Find if any completion marker should appear before this message
                    const markersBefore = completionMarkers.filter(
                      (m) => idx > 0 && m.time >= timelineMessages[idx - 1].timestamp && m.time < msg.timestamp,
                    );

                    return (
                      <>
                        {/* Completion markers */}
                        {markersBefore.map((marker) => {
                          const borderColor = marker.border;
                          return (
                            <tr key={`completion-${marker.type}-${marker.time}`}>
                              <td colSpan={5} className={`border-l-4 ${borderColor} p-3 bg-base-200`}>
                                <div className="flex items-center gap-4">
                                  <div className="badge badge">{formatTime(marker.time)}</div>
                                  <div className="font-semibold">{marker.label} would complete here</div>
                                  <div className="text-sm opacity-70">{marker.explanation}</div>
                                  <div className="badge badge ml-auto">{marker.eventCount} events</div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}

                        {/* Message row */}
                        <tr key={idx}>
                          <td className="font-mono text-sm">{formatTime(msg.timestamp)}</td>
                          <td className="font-mono text-sm truncate max-w-[200px]">{msg.from}</td>
                          <td>
                            <div className={`badge badge ${MESSAGE_STYLES[msgType] || "badge-ghost"}`}>{msg.type}</div>
                          </td>
                          <td className="font-mono text-sm">{details}</td>
                          <td className="font-mono text-sm">{formatTime(msg.deltaTime)}</td>
                        </tr>
                      </>
                    );
                  })}

                  {/* Completion markers at the end */}
                  {completionMarkers
                    .filter(
                      (m) =>
                        timelineMessages.length === 0 ||
                        m.time >= timelineMessages[timelineMessages.length - 1].timestamp,
                    )
                    .map((marker) => {
                      const borderColor = marker.border;
                      return (
                        <tr key={`completion-${marker.type}-${marker.time}`}>
                          <td colSpan={5} className={`border-l-4 ${borderColor} p-3 bg-base-200`}>
                            <div className="flex items-center gap-4">
                              <div className="badge badge">{formatTime(marker.time)}</div>
                              <div className="font-semibold">{marker.label} would complete here</div>
                              <div className="text-sm opacity-70">{marker.explanation}</div>
                              <div className="badge badge ml-auto">{marker.eventCount} events</div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
