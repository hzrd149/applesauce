/**
 * Progressively load reaction, comment, repost and zap counts for a scrolling feed with the count service
 * @tags loader, count, nip-45, nip-85, stress
 * @related loader/infinite-scroll, feed/loading-reactions
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Note } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import {
  ensureWebSocketURL,
  getDisplayName,
  getProfilePicture,
  normalizeToPubkey,
  normalizeURL,
} from "applesauce-core/helpers";
import {
  createCountService,
  nip85CountSource,
  roundRobinCountSource,
  type CountService,
  createEventLoaderForStore,
  createTimelineLoader,
  legacyReferenceCountMetric,
  reactionCountMetric,
  rootCommentCountMetric,
  type AssertionRequest,
  type CountDiagnostic,
  type CountMetric,
  type CountRequest,
  type CountState,
} from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Heart,
  GripVertical,
  MessageSquare,
  Quote,
  Repeat2,
  Reply,
  Trash2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Fragment, useState, type DragEvent } from "react";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import {
  auditTime,
  BehaviorSubject,
  combineLatest,
  defer,
  distinctUntilChanged,
  EMPTY,
  finalize,
  ignoreElements,
  map,
  merge,
  Observable,
  ReplaySubject,
  scan,
  share,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
  tap,
  timer,
} from "rxjs";

import RelayAddForm from "../../components/add-relay-form";
import RelayPicker from "../../components/relay-picker";
import { historyWindows } from "../../extra/history-window";
import { lookupRelays$ } from "../../settings";

const NOTES = { kinds: [1] };
// How far back in time each older page of the feed reaches
const STEP = 3 * 60 * 60;
// Load an older page when the last rendered row is this close to the end
const PREFETCH = 3;
// The fixed height of a grid row and the minimum width of a note column
const ROW_HEIGHT = 84;
const COLUMN_WIDTH = 340;
// The service gives up on a single relay or provider after this long
const ATTEMPT_TIMEOUT = 5000;

const eventStore = new EventStore();
const pool = new RelayPool();
const countCache = new Keyv({
  store: new KeyvIndexedDB({ dbName: "applesauce-examples", storeName: "counts" }),
});
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

const COUNT_RELAYS = ["wss://relay.primal.net/", "wss://relay.ditto.pub/", "wss://relay.nostr.net/"];
const COUNT_PRESETS = [
  { label: "Ordered", groups: COUNT_RELAYS.map((relay) => [relay]) },
  { label: "Round-robin", groups: [[...COUNT_RELAYS]] },
  { label: "Grouped fallback", groups: [COUNT_RELAYS.slice(0, 2), COUNT_RELAYS.slice(2)] },
];

// Relay groups are ordered; each group distributes its requests round-robin.
const countRelays$ = new BehaviorSubject<string[][]>(COUNT_PRESETS[0].groups.map((group) => [...group]));
const provider$ = new BehaviorSubject<{ pubkey: string; relay: string } | null>(null);

type Outcome = "sent" | "answered" | "refused" | "failed" | "timeout" | "cancelled";
type Transport = { type: "count" | "assertion"; outcome: Outcome };

const transports$ = new Subject<Transport>();
const diagnostics$ = new Subject<CountDiagnostic>();

/** Reports how each upstream request ended, since the service only sees when a transport settles */
function track<T>(type: Transport["type"], request: Observable<T>, answer: (value: T) => Outcome | undefined) {
  return defer(() => {
    const started = Date.now();
    let settled = false;
    const report = (outcome: Outcome) => {
      settled = true;
      transports$.next({ type, outcome });
    };

    transports$.next({ type, outcome: "sent" });
    return request.pipe(
      tap({
        next: (value) => {
          const outcome = settled ? undefined : answer(value);
          if (outcome) report(outcome);
        },
        complete: () => settled || report("answered"),
        error: () => settled || report("failed"),
      }),
      // Unsubscribed without an answer: either the attempt timed out or its row scrolled away
      finalize(() => settled || report(Date.now() - started >= ATTEMPT_TIMEOUT ? "timeout" : "cancelled")),
    );
  });
}

const count: CountRequest = (relays, filters) =>
  track("count", pool.count(relays, filters), (outcomes) => {
    const results = Object.values(outcomes);
    if (results.length) return results.every((result) => result.ok) ? "answered" : "refused";
  });
const request: AssertionRequest = (relays, filters) =>
  track("assertion", pool.request(relays, filters), () => undefined);

// Each priority group shares count requests between its trusted relays.
const assertionSource = nip85CountSource({
  request,
  providers: (kind, tag) =>
    provider$.pipe(map((p) => (p ? [{ kind, tag, servicePubkey: p.pubkey, relay: p.relay }] : []))),
});

// Only include NIP-85 when a provider is configured, so plain relay lookups skip the assertion attempt
const counts$ = combineLatest([provider$.pipe(map(Boolean), distinctUntilChanged()), countRelays$]).pipe(
  switchMap(
    ([nip85, groups]) =>
      new Observable<CountService>((subscriber) => {
        const relaySources = groups.map((relays, index) =>
          roundRobinCountSource({ count, relays, id: `relay-group-${index}` }),
        );
        const service = createCountService({
          cache: countCache,
          ttl: () => 5 * 60_000,
          cacheRetention: 24 * 60 * 60_000,
          sources: nip85 ? [assertionSource, ...relaySources] : relaySources,
          // Single-relay groups can still receive every request
          perRelay: 6,
          attemptTimeout: ATTEMPT_TIMEOUT,
          diagnostic: (event) => diagnostics$.next(event),
        });
        subscriber.next(service);

        // Replacing the service cancels its queued work and refresh timers
        return () => service.stop();
      }),
  ),
  shareReplay(1),
);

// Built-in metrics plus custom ones with their COUNT filters and NIP-85 assertion tags
const METRICS: { label: string; icon: LucideIcon; metric: CountMetric }[] = [
  { label: "Reactions", icon: Heart, metric: reactionCountMetric },
  { label: "Comments", icon: MessageSquare, metric: rootCommentCountMetric },
  { label: "Replies", icon: Reply, metric: legacyReferenceCountMetric },
  {
    label: "Reposts",
    icon: Repeat2,
    metric: {
      id: "reposts:v1",
      unit: "events",
      assertionTag: "repost_cnt",
      filters: (target) => (target.address ? undefined : [{ kinds: [6, 16], "#e": [target.id] }]),
    },
  },
  {
    label: "Quotes",
    icon: Quote,
    metric: {
      id: "quotes:v1",
      unit: "events",
      assertionTag: "quote_cnt",
      filters: (target) => (target.address ? undefined : [{ kinds: [1], "#q": [target.id] }]),
    },
  },
  {
    label: "Zaps",
    icon: Zap,
    metric: {
      id: "zaps:v1",
      unit: "events",
      assertionTag: "zap_cnt",
      filters: (target) => (target.address ? undefined : [{ kinds: [9735], "#e": [target.id] }]),
    },
  },
];

type Tally = Record<Outcome, number>;
type Stats = {
  /** The latest service snapshot */
  gauges: Pick<CountDiagnostic, "active" | "pending" | "activeMetrics" | "cacheEntries">;
  /** Totals for each diagnostic type, such as queued, abandoned and cache-hit */
  events: Record<string, number>;
  /** The summed first-value latency in milliseconds */
  latency: number;
  count: Tally;
  assertion: Tally;
};

const TALLY: Tally = { sent: 0, answered: 0, refused: 0, failed: 0, timeout: 0, cancelled: 0 };
const EMPTY_STATS: Stats = {
  gauges: { active: 0, pending: 0, activeMetrics: 0, cacheEntries: 0 },
  events: {},
  latency: 0,
  count: TALLY,
  assertion: TALLY,
};

function reduce(stats: Stats, event: CountDiagnostic | Transport): Stats {
  if ("outcome" in event)
    return { ...stats, [event.type]: { ...stats[event.type], [event.outcome]: stats[event.type][event.outcome] + 1 } };

  const { type, latency, ...gauges } = event;
  return {
    ...stats,
    gauges,
    events: { ...stats.events, [type]: (stats.events[type] ?? 0) + 1 },
    latency: stats.latency + (latency ?? 0),
  };
}

const reset$ = new Subject<void>();
const stats$ = reset$.pipe(
  startWith(undefined),
  switchMap(() => merge(diagnostics$, transports$).pipe(scan(reduce, EMPTY_STATS), startWith(EMPTY_STATS))),
  // Tally every event before limiting how often the panel renders
  auditTime(100),
);

const more$ = new Subject<void>();

/** Loads kind 1 notes from one relay, reaching another step further back for each older page request */
function feed$(relay: string) {
  const loader = createTimelineLoader(pool, [relay], NOTES, { eventStore, limit: 200 });

  return defer(() => {
    const windows$ = historyWindows(more$, STEP).pipe(share({ connector: () => new ReplaySubject(1) }));
    const notes$ = windows$.pipe(
      switchMap(({ since }) => eventStore.timeline({ ...NOTES, since })),
      castTimelineStream(Note, eventStore),
    );
    const loading$ = loader.status$.pipe(
      map((statuses) => statuses.length === 0 || statuses.some((status) => status.state === "loading")),
      startWith(true),
    );

    return combineLatest([notes$, loading$, loader(windows$).pipe(ignoreElements(), startWith(null))]).pipe(
      map(([notes, loading]) => ({ notes, loading })),
    );
  });
}

function describe(label: string, state: CountState | undefined) {
  if (state?.value !== undefined) {
    const origin = state.origin?.provider
      ? `NIP-85 provider ${state.origin.provider.slice(0, 8)} on ${state.origin.relay}`
      : state.origin?.relay;
    return `${label}: ${state.value} from ${origin}${state.fresh ? "" : " (stale)"}`;
  }
  if (!state || state.refreshing) return `${label}: loading`;

  const failure = state.failure instanceof Error ? state.failure.message : String(state.failure ?? "no answer");
  return `${label}: unavailable, ${failure}`;
}

function MetricCount({ note, entry }: { note: Note; entry: (typeof METRICS)[number] }) {
  // Subscribing starts the request, unmounting cancels it if it is still queued or in flight
  const state = use$(
    () => counts$.pipe(switchMap((counts) => counts.event(note.event).metric(entry.metric))),
    [note, entry],
  );
  const Icon = entry.icon;

  // Fade zero counts so the counts that found data stand out
  return (
    <span
      className={`flex items-center gap-1 text-sm ${state?.value === 0 ? "opacity-30" : state?.fresh ? "" : "text-base-content/60"}`}
      title={describe(entry.label, state)}
    >
      <Icon className="h-4 w-4" />
      {state?.value !== undefined ? (
        `${state.approximate ? "~" : ""}${state.value}`
      ) : !state || state.refreshing ? (
        <span className="loading loading-dots loading-sm" />
      ) : (
        "—"
      )}
      {state?.origin && <RelayColor relay={state.origin.relay} />}
    </span>
  );
}

/** Uses a stable relay color across counts, grouping changes, and reloads */
function RelayColor({ relay }: { relay: string }) {
  const url = normalizeURL(relay);
  const preset = COUNT_RELAYS.indexOf(url);
  let hash = 0;
  for (const char of url) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) | 0;
  const hue = preset >= 0 ? [210, 35, 155][preset] : ((hash >>> 0) * 137.508) % 360;
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      role="img"
      aria-label={`Relay: ${relay}`}
      title={relay}
      style={{ backgroundColor: `hsl(${hue} 75% 55%)` }}
    />
  );
}

function FeedNote({ note }: { note: Note }) {
  const profile = use$(note.author.profile$);

  return (
    <article className="min-w-0 border-b border-r border-base-300 px-3 py-2" style={{ height: ROW_HEIGHT }}>
      <div className="flex items-center gap-2">
        <img
          src={getProfilePicture(profile, `https://robohash.org/${note.author.pubkey}.png`)}
          className="h-5 w-5 shrink-0 rounded-full"
          alt=""
        />
        <span className="min-w-0 truncate font-semibold">{getDisplayName(profile)}</span>
        <time className="ml-auto shrink-0 text-sm text-base-content/60">
          {new Date(note.event.created_at * 1000).toLocaleTimeString()}
        </time>
      </div>
      <p className="truncate text-sm text-base-content/70">{note.event.content}</p>
      <div className="mt-1 flex gap-3 overflow-hidden">
        {METRICS.map((entry) => (
          <MetricCount key={entry.metric.id} note={note} entry={entry} />
        ))}
      </div>
    </article>
  );
}

/** Emits how many note columns fit in the element as it resizes */
function columns$(element: HTMLElement | null) {
  return new Observable<number>((observer) => {
    if (!element) return observer.next(1);
    const measure = () => observer.next(Math.max(1, Math.floor(element.clientWidth / COLUMN_WIDTH)));
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    measure();
    return () => resize.disconnect();
  });
}

function Feed({ notes, loading }: { notes: Note[]; loading: boolean }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const columns = use$(() => columns$(scroller), [scroller]) ?? 1;
  const rowCount = Math.ceil(notes.length / columns);

  // Virtualize rows of notes, each row is a fixed height so nothing needs measuring
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller,
    getItemKey: (index) => notes[index * columns]?.id ?? index,
    estimateSize: () => ROW_HEIGHT,
    // No overscan, rows that leave the viewport release their counts immediately
    overscan: 0,
  });

  // Request an older page once the previous one has loaded and the last rows are on screen
  const rows = virtualizer.getVirtualItems();
  const nearEnd = !loading && (rows[rows.length - 1]?.index ?? -1) >= rowCount - PREFETCH;
  use$(() => (nearEnd ? timer(0).pipe(tap(() => more$.next())) : EMPTY), [nearEnd, rowCount]);

  return (
    <div ref={setScroller} className="min-h-0 flex-1 overflow-y-auto">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => (
          <div
            key={row.key}
            className="absolute left-0 top-0 grid w-full"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {notes.slice(row.index * columns, (row.index + 1) * columns).map((note) => (
              <FeedNote key={note.id} note={note} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-center p-4">
        {loading ? (
          <span className="loading loading-spinner" role="status" />
        ) : (
          <button className="btn" onClick={() => more$.next()}>
            Load older notes
          </button>
        )}
      </div>
    </div>
  );
}

// Separate drag payloads let relay drops stack while group drops reorder
const RELAY_DRAG = "application/x-count-relay";
const GROUP_DRAG = "application/x-count-group";

/** Moves a priority group and re-resolves visible counts */
function moveGroup(from: number, to: number) {
  const next = [...countRelays$.value];
  if (from === to || !next[from] || !next[to]) return;
  next.splice(to, 0, ...next.splice(from, 1));
  countRelays$.next(next);
}

/** Moves a relay into another priority group */
function groupRelay(relay: string, target: number) {
  const groups = countRelays$.value;
  const destination = groups[target];
  if (!destination || destination.includes(relay)) return;
  const next = groups
    .map((group) => {
      const remaining = group.filter((value) => value !== relay);
      return group === destination ? [...remaining, relay] : remaining;
    })
    .filter((group) => group.length);
  countRelays$.next(next);
}

function CountRelayItem({ relay }: { relay: string }) {
  const name = use$(() => pool.relay(relay).name$, [relay]);
  const supported = use$(() => pool.relay(relay).supported$, [relay]);
  const nip45 = supported === undefined ? undefined : !!supported?.includes(45);
  return (
    <div
      className="flex cursor-grab items-center gap-2 px-2 py-1 active:cursor-grabbing"
      draggable
      title="Drag relay"
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.setData(RELAY_DRAG, relay);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-base-content/40" />
      <RelayColor relay={relay} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name ?? relay}</div>
        <div className="truncate text-sm text-base-content/60">{relay}</div>
      </div>
      {nip45 === undefined ? (
        <span className="loading loading-spinner loading-sm" />
      ) : nip45 ? (
        <Check className="h-5 w-5 text-success" aria-label="Supports NIP-45" />
      ) : (
        <X className="h-5 w-5 text-error" aria-label="Does not advertise NIP-45" />
      )}
      <button
        className="btn btn-ghost btn-sm px-1"
        title={`Remove ${relay}`}
        onClick={() =>
          countRelays$.next(countRelays$.value.map((g) => g.filter((r) => r !== relay)).filter((g) => g.length))
        }
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Inserts a dragged relay or group at a boundary between priority groups */
function insertCountGroup(event: DragEvent, position: number) {
  const groups = countRelays$.value;
  const relay = event.dataTransfer.getData(RELAY_DRAG);
  const from = event.dataTransfer.getData(GROUP_DRAG);
  if (relay && groups.some((group) => group.includes(relay))) {
    const before = groups
      .slice(0, position)
      .map((group) => group.filter((r) => r !== relay))
      .filter((g) => g.length);
    const after = groups
      .slice(position)
      .map((group) => group.filter((r) => r !== relay))
      .filter((g) => g.length);
    countRelays$.next([...before, [relay], ...after]);
  } else if (from !== "" && groups[Number(from)]) {
    const index = Number(from);
    moveGroup(index, position > index ? position - 1 : position);
  }
}

function CountPresets() {
  const groups = use$(countRelays$);
  const provider = use$(provider$);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">Presets</h2>
      <div className="flex flex-wrap gap-2">
        {COUNT_PRESETS.map((preset) => {
          const active = !provider && JSON.stringify(groups) === JSON.stringify(preset.groups);
          return (
            <button
              key={preset.label}
              className={`btn btn-sm ${active ? "btn-primary" : ""}`}
              aria-pressed={active}
              onClick={() => {
                provider$.next(null);
                countRelays$.next(preset.groups.map((group) => [...group]));
              }}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function CountRelays() {
  const groups = use$(countRelays$);
  const [over, setOver] = useState<string | null>(null);
  const accepts = (event: DragEvent) =>
    event.dataTransfer.types.includes(RELAY_DRAG) || event.dataTransfer.types.includes(GROUP_DRAG);
  const boundary = (index: number) => (
    <li
      className={`h-3 rounded border transition-colors ${over === `slot-${index}` ? "border-primary bg-primary/20" : "border-transparent"}`}
      aria-label={`Insert group at position ${index + 1}`}
      onDragOver={(e) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(`slot-${index}`);
      }}
      onDragLeave={() => setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(null);
        insertCountGroup(e, index);
      }}
    />
  );
  return (
    <section className="flex flex-col gap-2" onDragEnd={() => setOver(null)}>
      <h2 className="font-semibold">COUNT relays</h2>
      <ol className="flex flex-col">
        {groups.map((group, i) => (
          <Fragment key={JSON.stringify(group)}>
            {boundary(i)}
            <li
              className={`border ${over === `group-${i}` ? "border-primary bg-primary/10" : "border-base-300"}`}
              onDragOver={(e) => {
                if (!accepts(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver(`group-${i}`);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const relay = e.dataTransfer.getData(RELAY_DRAG);
                if (relay && groups.some((g) => g.includes(relay))) groupRelay(relay, i);
                else {
                  const from = e.dataTransfer.getData(GROUP_DRAG);
                  if (from !== "") moveGroup(Number(from), i);
                }
              }}
            >
              <div className="flex items-center gap-2 border-b border-base-300 px-2 py-1">
                <span
                  className="flex flex-1 cursor-grab items-center gap-1 text-sm"
                  draggable
                  title="Drag group"
                  onDragStart={(e) => {
                    e.dataTransfer.setData(GROUP_DRAG, String(i));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <GripVertical className="h-4 w-4 text-base-content/40" />
                  {i + 1}
                  {group.length > 1 ? " · Round-robin" : ""}
                </span>
                <button
                  className="btn btn-ghost btn-sm px-1"
                  disabled={i === 0}
                  title="Move group up"
                  onClick={() => moveGroup(i, i - 1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  className="btn btn-ghost btn-sm px-1"
                  disabled={i === groups.length - 1}
                  title="Move group down"
                  onClick={() => moveGroup(i, i + 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
              {group.map((relay) => (
                <CountRelayItem key={relay} relay={relay} />
              ))}
            </li>
          </Fragment>
        ))}
        {boundary(groups.length)}
        {groups.length === 0 && <li className="text-sm text-base-content/70">No relays</li>}
      </ol>
      <RelayAddForm onSubmit={(relay) => groups.flat().includes(relay) || countRelays$.next([...groups, [relay]])} />
    </section>
  );
}

function ProviderSettings() {
  const provider = use$(provider$);
  const [pubkey, setPubkey] = useState(provider?.pubkey ?? "");
  const [relay, setRelay] = useState(provider?.relay ?? "");
  const [error, setError] = useState("");

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const hex = normalizeToPubkey(pubkey.trim());
    if (!hex) return setError("Enter a hex pubkey or npub");
    try {
      provider$.next({ pubkey: hex, relay: normalizeURL(ensureWebSocketURL(relay.trim())) });
      setError("");
    } catch {
      setError("Enter a valid relay URL");
    }
  };

  return (
    <form className="flex flex-col gap-2" onSubmit={apply}>
      <h2 className="font-semibold">NIP-85 provider</h2>
      <input
        className="input w-full"
        placeholder="Provider pubkey or npub"
        value={pubkey}
        onChange={(e) => setPubkey(e.target.value)}
      />
      <input
        className="input w-full"
        placeholder="wss://provider.relay"
        value={relay}
        onChange={(e) => setRelay(e.target.value)}
      />
      {error && <p className="text-sm text-error">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary btn-sm">
          {provider ? "Update" : "Use provider"}
        </button>
        {provider && (
          <button type="button" className="btn btn-sm" onClick={() => provider$.next(null)}>
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

function StatTable({ title, rows }: { title: string; rows: [label: string, value: number | string, hint?: string][] }) {
  return (
    <div className="border border-base-300">
      <h3 className="border-b border-base-300 px-3 py-1 font-semibold">{title}</h3>
      <table className="table">
        <tbody>
          {rows.map(([label, value, hint]) => (
            <tr key={label} title={hint}>
              <td>{label}</td>
              <td className="text-right font-mono">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function transportRows(tally: Tally): [string, number, string][] {
  return [
    ["Sent", tally.sent, "Requests sent to a relay"],
    ["Answered", tally.answered, "Requests that returned a result"],
    ["Refused", tally.refused, "Relays that rejected the COUNT"],
    ["Failed", tally.failed, "Requests that errored"],
    ["Timed out", tally.timeout, `No answer within ${ATTEMPT_TIMEOUT / 1000}s`],
    ["Cancelled in flight", tally.cancelled, "The row scrolled away before the relay answered"],
  ];
}

function RequestStats() {
  const stats = use$(stats$) ?? EMPTY_STATS;
  const total = (type: string) => stats.events[type] ?? 0;
  const firstValues = total("first-value");
  const { active, pending, activeMetrics, cacheEntries } = stats.gauges;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Requests</h2>
        <div className="flex gap-2">
          <button
            className="btn btn-sm"
            onClick={() => counts$.pipe(take(1)).subscribe((counts) => void counts.invalidate().catch(console.error))}
            title="Visible rows refetch"
          >
            Clear cache
          </button>
          <button className="btn btn-sm" onClick={() => reset$.next()}>
            Reset stats
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 border border-base-300">
        {[
          ["Active", active],
          ["Queued", pending],
          ["Observed metrics", activeMetrics],
          ["Cached results", cacheEntries],
        ].map(([label, value]) => (
          <div key={label} className="border-base-300 p-3 odd:border-r [&:nth-child(-n+2)]:border-b">
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-sm text-base-content/70">{label}</div>
          </div>
        ))}
      </div>

      <StatTable
        title="Scheduler"
        rows={[
          ["Queued", total("queued"), "Requests waiting for a free slot"],
          ["Started", total("start"), "Requests admitted and sent"],
          ["Cancelled before sending", total("abandoned"), "The row scrolled away while its request was queued"],
          ["Overloaded", total("overload"), "Rejected because the queue was full"],
        ]}
      />
      <StatTable title="NIP-45 COUNT" rows={transportRows(stats.count)} />
      <StatTable title="NIP-85 assertions" rows={transportRows(stats.assertion)} />
      <StatTable
        title="Cache (5 min freshness, 24 hr retention across reloads)"
        rows={[
          ["Restored", total("persistent-cache-hit"), "A saved count was restored from IndexedDB"],
          ["Hits", total("cache-hit"), "A fresh cached count was reused"],
          ["Misses", total("cache-miss"), "No fresh count, a request was needed"],
          ["Relay fallbacks", total("fallback"), "A relay answered after NIP-85 had no assertion"],
          ["Metrics released", total("released"), "Counts no longer observed by any row"],
          ["First values", firstValues],
          ["Avg time to first count", firstValues ? `${Math.round(stats.latency / firstValues)} ms` : "—"],
        ]}
      />
    </section>
  );
}

export default function EventCounts() {
  const [relay, setRelay] = useState("wss://pyramid.fiatjaf.com/");
  const feed = use$(() => feed$(relay), [relay]);

  return (
    <div className="flex min-h-0 grow">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-base-300 p-2">
          <RelayPicker value={relay} onChange={setRelay} />
        </div>
        {feed && !feed.loading && feed.notes.length === 0 && (
          <p className="p-4 text-base-content/70">No notes in this time range yet, load older notes below.</p>
        )}
        <Feed notes={feed?.notes ?? []} loading={feed?.loading ?? true} />
      </div>
      <aside className="flex min-h-0 w-96 flex-col gap-6 overflow-y-auto border-l border-base-300 p-4">
        <CountPresets />
        <CountRelays />
        <ProviderSettings />
        <RequestStats />
      </aside>
    </div>
  );
}
