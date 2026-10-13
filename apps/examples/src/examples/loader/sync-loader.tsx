/**
 * Confidently load a set of events from multiple relays using NIP-77 negentropy sync with a paginated request fallback
 * @tags loader, nip-77, negentropy, sync
 * @related loader/paginated-timeline, negentrapy/relay-difference
 */
import { castUser } from "applesauce-common/casts";
import { BehaviorSubject, combineLatest, scan, startWith, map, catchError, of } from "rxjs";

import { EventStore } from "applesauce-core";
import { getSeenRelays, mergeRelaySets, normalizeToPubkey } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, SyncLoaderStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { NostrEvent } from "applesauce-core/helpers";
import { useMemo } from "react";
import PubkeyPicker from "../../components/pubkey-picker";
import { lookupRelays$ } from "../../settings";

const eventStore = new EventStore();
const pool = new RelayPool();

// Resolve replaceable events (like the user's relay list) that aren't in the store yet
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: lookupRelays$,
});

// Create global sync loader
const syncLoader = createSyncLoader({ eventStore, pool });

// derek
const DEFAULT_PUBKEY = normalizeToPubkey("npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424");

const DAY = 24 * 60 * 60 * 1000;

function dateInputValue(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function startOfDay(value: string): number | undefined {
  return value ? Math.floor(new Date(`${value}T00:00:00`).getTime() / 1000) : undefined;
}

function endOfDay(value: string): number | undefined {
  return value ? Math.floor(new Date(`${value}T23:59:59`).getTime() / 1000) : undefined;
}

/** Strips the protocol and trailing slash from a relay url for display */
function hostname(url: string): string {
  return url.replace(/^wss:\/\//, "").replace(/\/$/, "");
}

/** Renders the full status snapshot of the sync loader */
function StatusPanel({ status }: { status: SyncLoaderStatus }) {
  const relays = Object.values(status.relays);
  return (
    <div className="border border-base-300 rounded-lg p-4">
      <div className="flex items-center gap-3 mb-3">
        <span className="font-bold">Status</span>
        <span className="text-sm opacity-70">
          {status.done ? "done" : "syncing"} · {status.loaded} unique events
        </span>
      </div>

      <table className="table table-sm">
        <thead>
          <tr>
            <th>Relay</th>
            <th>State</th>
            <th>NIP-77</th>
            <th>Method</th>
            <th className="text-right">Events</th>
          </tr>
        </thead>
        <tbody>
          {relays.map((relay) => (
            <tr key={relay.relay}>
              <td className="font-mono text-sm">{hostname(relay.relay)}</td>
              <td>
                {relay.state}
                {relay.error && <span className="text-error text-sm ml-2">{relay.error.message}</span>}
              </td>
              <td>{relay.negentropy === undefined ? "—" : relay.negentropy ? "✅" : "❌"}</td>
              <td>{relay.method ?? "—"}</td>
              <td className="text-right">{relay.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Renders a single synced event with a column per relay showing the method used to fetch it from each */
function EventRow({
  event,
  index,
  relays,
  status,
}: {
  event: NostrEvent;
  index: number;
  relays: string[];
  status?: SyncLoaderStatus;
}) {
  const seen = getSeenRelays(event);

  return (
    <tr>
      <td className="opacity-50">{index + 1}</td>
      <td className="font-mono text-sm">{event.id.slice(0, 12)}…</td>
      <td>{event.kind}</td>
      {relays.map((relay) => (
        <td key={relay} className="text-sm">
          {seen?.has(relay) ? (status?.relays[relay]?.method ?? "✅") : ""}
        </td>
      ))}
    </tr>
  );
}

export default function SyncLoaderExample() {
  const pubkey$ = useMemo(() => new BehaviorSubject(DEFAULT_PUBKEY), []);
  const pubkey = use$(pubkey$);

  const relaysText$ = useMemo(() => new BehaviorSubject(""), []);
  const relaysText = use$(relaysText$);

  const sinceDate$ = useMemo(() => new BehaviorSubject(dateInputValue(new Date(Date.now() - 14 * DAY))), []);
  const sinceDate = use$(sinceDate$);

  const untilDate$ = useMemo(() => new BehaviorSubject(dateInputValue(new Date())), []);
  const untilDate = use$(untilDate$);

  const user = useMemo(() => castUser(pubkey, eventStore), [pubkey]);
  const outboxes = use$(user.outboxes$);
  const effectiveRelaysText = relaysText || outboxes?.join("\n") || "";
  const relays = useMemo(() => mergeRelaySets(effectiveRelaysText.split(/\s+/)), [effectiveRelaysText]);
  const invalidRange = !!sinceDate && !!untilDate && sinceDate > untilDate;
  const run$ = useMemo(() => new BehaviorSubject<ReturnType<typeof syncLoader> | null>(null), []);
  const run = use$(run$);
  const state = use$<{ status: SyncLoaderStatus | null; events: NostrEvent[]; error?: string }>(
    () =>
      run
        ? combineLatest([
            run.status$,
            run.events$.pipe(
              scan((events, event) => [...events, event], [] as NostrEvent[]),
              startWith([] as NostrEvent[]),
            ),
          ]).pipe(
            map(([status, events]) => ({ status, events })),
            catchError((error) => of({ status: null, events: [] as NostrEvent[], error: String(error) })),
          )
        : of({ status: null, events: [] as NostrEvent[] }),
    [run],
  );
  const status = state?.status;
  const events = state?.events ?? [];
  const running = !!run && !status?.done && !state?.error;
  const stop = () => run$.next(null);
  const sync = () => {
    if (invalidRange) return;
    const since = startOfDay(sinceDate);
    const until = endOfDay(untilDate);
    run$.next(
      syncLoader({
        relays,
        filter: {
          kinds: [1],
          authors: [pubkey],
          ...(since !== undefined && { since }),
          ...(until !== undefined && { until }),
        },
      }),
    );
  };

  return (
    <div className="container mx-auto my-8 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold">User</label>
        <PubkeyPicker value={pubkey} onChange={(value: typeof pubkey$.value) => pubkey$.next(value)} />

        <label className="text-sm font-bold">Relays (defaults to the user's outboxes)</label>
        <textarea
          className="textarea textarea-bordered font-mono text-sm h-28"
          value={effectiveRelaysText}
          onChange={(e) => relaysText$.next(e.target.value)}
          placeholder="wss://relay.example.com"
        />

        <label className="text-sm font-bold">Date range</label>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Since
            <input
              className="input input-bordered"
              type="date"
              value={sinceDate}
              onChange={(e) => sinceDate$.next(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Until
            <input
              className="input input-bordered"
              type="date"
              value={untilDate}
              onChange={(e) => untilDate$.next(e.target.value)}
            />
          </label>
        </div>
        {invalidRange && <div className="text-error text-sm">Since must be on or before until.</div>}

        <div className="flex gap-2">
          {running ? (
            <button className="btn btn-error" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={sync} disabled={relays.length === 0 || invalidRange}>
              Sync
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              stop();
            }}
          >
            Clear
          </button>
        </div>
      </div>

      {state?.error && (
        <p role="alert" className="text-error">
          {state.error}
        </p>
      )}
      {status && <StatusPanel status={status} />}

      <div className="border border-base-300 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="font-bold">Synced events</span>
          <span className="text-sm opacity-70">{events.length} received</span>
          {running && <span className="loading loading-dots loading-sm" />}
        </div>

        <table className="table table-sm">
          <thead>
            <tr>
              <th>#</th>
              <th>Event ID</th>
              <th>Kind</th>
              {relays.map((relay) => (
                <th key={relay} className="font-mono text-sm font-normal" title={relay}>
                  {hostname(relay)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event, index) => (
              <EventRow key={event.id} event={event} index={index} relays={relays} status={status ?? undefined} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
