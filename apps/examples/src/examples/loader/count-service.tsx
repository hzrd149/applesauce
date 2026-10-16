/**
 * Compare demand-driven COUNT, batched assertions, and related event downloads in a virtual timeline
 * @tags loader, count, nip-45, nip-85, stress
 * @related loader/timeline-scrubber
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { createCountService, nip85CountSource, relayCountSource } from "applesauce-loaders/loaders";
import type { CountService, CountTarget } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useRef, useState } from "react";
import { BehaviorSubject, ignoreElements, interval, NEVER, Observable, shareReplay, switchMap, tap } from "rxjs";
import {
  CountStressMonitor,
  countStressTargets,
  countStressTransports,
  stressProviderKey,
} from "../../helpers/count-service-stress";

const targets = countStressTargets();
const pool = new RelayPool();
const settings$ = new BehaviorSubject({
  mode: "count",
  latency: 150,
  concurrency: 8,
  perRelay: 2,
  ttl: 30000,
  window: 10,
  relay: "",
  liveIds: "",
  revision: 0,
});
const relays$ = new BehaviorSubject<readonly string[]>(["wss://simulation.test/"]);
const providerRelays$ = new BehaviorSubject<readonly string[]>(["wss://simulation.test/"]);
const providers$ = new BehaviorSubject([{ pubkey: stressProviderKey, relays$: providerRelays$ }]);
const sessions$ = settings$.pipe(
  switchMap(
    (settings) =>
      new Observable<{ counts: CountService; monitor: CountStressMonitor }>((subscriber) => {
        const monitor = new CountStressMonitor();
        const simulated = countStressTransports(monitor, settings.latency);
        const live = settings.mode === "live";
        const counts = createCountService({
          sources:
            settings.mode === "baseline"
              ? [simulated.baseline]
              : [
                  ...(settings.mode === "assertions"
                    ? [
                        nip85CountSource({
                          request: simulated.request,
                          providers: () => providers$,
                          verify: () => true,
                          batchWindow: settings.window,
                        }),
                      ]
                    : []),
                  relayCountSource({
                    count: live ? (routes, filters) => monitor.track(pool.count(routes, filters)) : simulated.count,
                    relays: live ? (settings.relay ? [settings.relay] : []) : relays$,
                  }),
                ],
          ttl: ({ age }) => (age < 3600 ? settings.ttl : settings.ttl * 10),
          concurrency: settings.concurrency,
          perRelay: settings.perRelay,
          diagnostic: monitor.diagnostic,
        });
        subscriber.next({ counts, monitor });
        return () => counts.stop();
      }),
  ),
  shareReplay({ bufferSize: 1, refCount: true }),
);

function Row({ target, counts, index }: { target: CountTarget; counts: CountService; index: number }) {
  const reactions = use$(() => counts.event(target).reactions, [counts, target]);
  const comments = use$(() => counts.event(target).comments$, [counts, target]);
  // A second component subscribes to the same canonical metric without issuing a second request.
  return (
    <div className="flex h-24 items-center justify-between gap-4 border-b border-base-300 px-4">
      <div>
        <div>Event {index + 1}</div>
        <div className="text-sm opacity-60">
          {target.id.slice(-12)} · {new Date(target.created_at * 1000).toLocaleString()}
        </div>
      </div>
      <div className="flex gap-4">
        <span>
          Reactions {reactions?.value ?? "…"}
          {reactions?.refreshing ? " ↻" : ""}
        </span>
        <DuplicateMetric counts={counts} target={target} />
        <span>Comments {comments ?? "…"}</span>
      </div>
    </div>
  );
}
function DuplicateMetric({ counts, target }: { counts: CountService; target: CountTarget }) {
  const value = use$(() => counts.event(target).reactions$, [counts, target]);
  return <span className="text-sm opacity-60">shared {value ?? "…"}</span>;
}
function Measurements({ monitor }: { monitor: CountStressMonitor }) {
  const stats = use$(monitor.snapshots$);
  if (!stats) return null;
  return (
    <div
      className="flex flex-wrap gap-x-5 gap-y-2 border-y border-base-300 p-3 text-sm"
      data-testid="count-measurements"
    >
      <span>Requests {stats.requests}</span>
      <span>Active {stats.active}</span>
      <span>Pending {stats.pending}</span>
      <span>Abandoned {stats.abandoned}</span>
      <span>Cancelled {stats.cancelled}</span>
      <span>Fallbacks {stats.fallbacks}</span>
      <span>
        Cache hits {stats.hits}/{stats.hits + stats.misses}
      </span>
      <span>Simulated wire {(stats.bytes / 1024).toFixed(1)} KiB</span>
      <span>Subjects/request {(stats.subjects / Math.max(1, stats.requests)).toFixed(1)}</span>
      <span>
        First value p50/p95 {stats.firstP50.toFixed(0)}/{stats.firstP95.toFixed(0)} ms
      </span>
      <span>
        Transport p50/p95 {stats.p50.toFixed(0)}/{stats.p95.toFixed(0)} ms
      </span>
    </div>
  );
}

export default function CountServiceExample() {
  const settings = use$(settings$)!;
  const session = use$(sessions$);
  const parent = useRef<HTMLDivElement>(null);
  const [relay, setRelay] = useState("");
  const [ids, setIds] = useState("");
  const [scrollRate, setScrollRate] = useState(0);
  const live = settings.mode === "live";
  const rows = live
    ? settings.liveIds
        .split(/\s+/)
        .filter((id) => /^[0-9a-f]{64}$/.test(id))
        .map((id) => ({ id, created_at: 0, kind: 1 }))
    : targets;
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 96,
    overscan: 5,
  });
  use$(
    () =>
      live || scrollRate === 0
        ? NEVER
        : interval(100).pipe(
            tap(() => parent.current?.scrollBy({ top: (scrollRate * 96) / 10 })),
            ignoreElements(),
          ),
    [live, scrollRate],
  );
  const update = (patch: Partial<typeof settings>) => settings$.next({ ...settings$.value, ...patch });
  return (
    <div className="flex min-h-0 grow flex-col gap-3">
      <p>
        Only mounted rows request metrics. Compare the same seeded data with COUNT, assertions, or downloading related
        events. Simulated assertions deliberately bypass signature checks.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          Source
          <select
            aria-label="Source"
            className="select select-bordered block"
            value={settings.mode}
            onChange={(e) => update({ mode: e.target.value })}
          >
            <option value="count">COUNT simulation</option>
            <option value="assertions">NIP-85 then COUNT</option>
            <option value="baseline">Related event downloads</option>
            <option value="live">Manual live relay</option>
          </select>
        </label>
        {(
          [
            ["latency", "Latency ms", [50, 150, 500]],
            ["concurrency", "Global limit", [2, 8, 16]],
            ["perRelay", "Relay limit", [1, 2, 8]],
            ["ttl", "Recent TTL ms", [1000, 30000, 300000]],
            ["window", "Batch window ms", [0, 10, 30]],
          ] as const
        ).map(([key, label, values]) => (
          <label key={key}>
            {label}
            <select
              className="select select-bordered block"
              aria-label={label}
              value={settings[key]}
              onChange={(e) => update({ [key]: Number(e.target.value) })}
            >
              {values.map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        ))}
        <button className="btn" onClick={() => update({ revision: settings.revision + 1 })}>
          Reset cache and measurements
        </button>
        <button
          className="btn"
          disabled={live}
          onClick={() =>
            virtual.scrollToIndex(
              Math.min(rows.length - 1, Math.max(0, (virtual.getVirtualItems()[0]?.index ?? 0) + 200)),
            )
          }
        >
          Forward 200
        </button>
        <button
          className="btn"
          disabled={live}
          onClick={() => virtual.scrollToIndex(Math.max(0, (virtual.getVirtualItems()[0]?.index ?? 0) - 200))}
        >
          Back 200
        </button>
      </div>
      {!live && (
        <label>
          Scroll rate (rows/second)
          <select
            aria-label="Scroll rate"
            className="select select-bordered ml-3"
            value={scrollRate}
            onChange={(e) => setScrollRate(Number(e.target.value))}
          >
            {[-200, -20, 0, 20, 200].map((rate) => (
              <option key={rate}>{rate}</option>
            ))}
          </select>
        </label>
      )}
      {!live && (
        <div className="flex flex-wrap gap-3">
          <button className="btn" onClick={() => relays$.next(relays$.value.length ? [] : ["wss://simulation.test/"])}>
            Toggle trusted COUNT relays
          </button>
          <button
            className="btn"
            onClick={() =>
              relays$.next(
                relays$.value.length > 1
                  ? [...relays$.value].reverse()
                  : ["wss://alternate.test/", "wss://simulation.test/"],
              )
            }
          >
            Reorder COUNT relays
          </button>
          <button
            className="btn"
            onClick={() =>
              providers$.next(providers$.value.length ? [] : [{ pubkey: stressProviderKey, relays$: providerRelays$ }])
            }
          >
            Toggle trusted assertion provider
          </button>
          <button
            className="btn"
            onClick={() =>
              providers$.next(
                providers$.value.length > 1
                  ? [...providers$.value].reverse()
                  : [
                      { pubkey: "c".repeat(64), relays$: providerRelays$ },
                      { pubkey: stressProviderKey, relays$: providerRelays$ },
                    ],
              )
            }
          >
            Reorder providers
          </button>
          <button
            className="btn"
            onClick={() =>
              providerRelays$.next(
                providerRelays$.value[0]?.includes("alternate")
                  ? ["wss://simulation.test/"]
                  : ["wss://alternate.test/"],
              )
            }
          >
            Change provider relay
          </button>
        </div>
      )}
      {live && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            update({ relay, liveIds: ids });
          }}
        >
          <label>
            Relay
            <input
              className="input input-bordered block"
              value={relay}
              onChange={(e) => setRelay(e.target.value)}
              placeholder="wss://…"
            />
          </label>
          <label>
            Event IDs
            <textarea
              className="textarea textarea-bordered block"
              value={ids}
              onChange={(e) => setIds(e.target.value)}
              placeholder="One hex event ID per line"
            />
          </label>
          <button className="btn" type="submit">
            Load selected events
          </button>
        </form>
      )}
      {live && (
        <p className="text-sm">
          Live mode reports request activity and first-value latency; simulated wire and transport latency measurements
          apply only to simulation.
        </p>
      )}
      {session && <Measurements monitor={session.monitor} />}
      <div ref={parent} className="min-h-0 flex-1 overflow-y-auto border border-base-300" data-testid="count-timeline">
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {session &&
            virtual.getVirtualItems().map((item) => (
              <div
                key={rows[item.index].id}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${item.start}px)`,
                }}
              >
                <Row target={rows[item.index]} counts={session.counts} index={item.index} />
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
