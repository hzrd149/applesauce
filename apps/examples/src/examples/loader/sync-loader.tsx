/**
 * Confidently load a set of events from multiple relays using NIP-77 negentropy sync with a paginated request fallback
 * @tags loader, nip-77, negentropy, sync
 * @related loader/paginated-timeline, negentrapy/relay-difference
 */
import { EventStore } from "applesauce-core";
import { getSeenRelays, mergeRelaySets, normalizeToPubkey } from "applesauce-core/helpers";
import { createEventLoaderForStore, createSyncLoader, SyncLoaderStatus } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { NostrEvent } from "nostr-tools";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PubkeyPicker from "../../components/pubkey-picker";

const eventStore = new EventStore();
const pool = new RelayPool();

// Resolve replaceable events (like the user's relay list) that aren't in the store yet
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Create global sync loader
const syncLoader = createSyncLoader({ eventStore, pool });

// derek
const DEFAULT_PUBKEY = normalizeToPubkey("npub18ams6ewn5aj2n3wt2qawzglx9mr4nzksxhvrdc4gzrecw7n5tvjqctp424");

// Time ranges to bound the sync so we don't reconcile a user's whole history
const RANGES: { label: string; days: number }[] = [
  { label: "Last 24 hours", days: 1 },
  { label: "Last week", days: 7 },
  { label: "Last 2 weeks", days: 14 },
  { label: "Last month", days: 30 },
  { label: "Last 2 month", days: 60 },
  { label: "All time", days: 0 },
];

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
              <td className="font-mono text-xs">{hostname(relay.relay)}</td>
              <td>
                {relay.state}
                {relay.error && <span className="text-error text-xs ml-2">{relay.error.message}</span>}
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
      <td className="font-mono text-xs">{event.id.slice(0, 12)}…</td>
      <td>{event.kind}</td>
      {relays.map((relay) => (
        <td key={relay} className="text-xs">
          {seen?.has(relay) ? (status?.relays[relay]?.method ?? "✅") : ""}
        </td>
      ))}
    </tr>
  );
}

export default function SyncLoaderExample() {
  const [pubkey, setPubkey] = useState(DEFAULT_PUBKEY);
  const [relaysText, setRelaysText] = useState("");
  const [rangeDays, setRangeDays] = useState(14);

  const [status, setStatus] = useState<SyncLoaderStatus | null>(null);
  const [events, setEvents] = useState<NostrEvent[]>([]);
  const [running, setRunning] = useState(false);

  const subscriptions = useRef<{ unsubscribe(): void }[]>([]);

  // Load the selected user's relay list and default the relay input to their outboxes
  const mailboxes = use$(() => (pubkey ? eventStore.mailboxes(pubkey) : undefined), [pubkey]);
  const outboxes = mailboxes?.outboxes?.join("\n");
  useEffect(() => {
    if (outboxes) setRelaysText(outboxes);
  }, [outboxes]);

  const relays = useMemo(() => mergeRelaySets(relaysText.split(/\s+/)), [relaysText]);

  const stop = useCallback(() => {
    subscriptions.current.forEach((sub) => sub.unsubscribe());
    subscriptions.current = [];
    setRunning(false);
  }, []);

  const sync = useCallback(() => {
    stop();
    setStatus(null);
    setEvents([]);
    setRunning(true);

    // Bound the sync to the selected time range
    const since = rangeDays > 0 ? Math.floor(Date.now() / 1000) - rangeDays * 24 * 60 * 60 : undefined;

    const { status$, events$ } = syncLoader({
      relays,
      filter: { kinds: [1], authors: [pubkey], ...(since !== undefined && { since }) },
    });

    // Subscribe to both observables so the shared run drives status and events together
    subscriptions.current = [
      status$.subscribe({ next: setStatus }),
      events$.subscribe({
        next: (event) => setEvents((prev) => [...prev, event]),
        complete: () => setRunning(false),
      }),
    ];
  }, [relays, pubkey, rangeDays, stop]);

  return (
    <div className="container mx-auto my-8 flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-bold">User</label>
        <PubkeyPicker value={pubkey} onChange={setPubkey} />

        <label className="text-sm font-bold">Relays (defaults to the user's outboxes)</label>
        <textarea
          className="textarea textarea-bordered font-mono text-xs h-28"
          value={relaysText}
          onChange={(e) => setRelaysText(e.target.value)}
          placeholder="wss://relay.example.com"
        />

        <label className="text-sm font-bold">Time range</label>
        <select
          className="select select-bordered"
          value={rangeDays}
          onChange={(e) => setRangeDays(Number(e.target.value))}
        >
          {RANGES.map((range) => (
            <option key={range.days} value={range.days}>
              {range.label}
            </option>
          ))}
        </select>

        <div className="flex gap-2">
          {running ? (
            <button className="btn btn-error" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="btn btn-primary" onClick={sync} disabled={relays.length === 0}>
              Sync
            </button>
          )}
          <button
            className="btn"
            onClick={() => {
              setEvents([]);
              setStatus(null);
            }}
          >
            Clear
          </button>
        </div>
      </div>

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
                <th key={relay} className="font-mono text-xs font-normal" title={relay}>
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
