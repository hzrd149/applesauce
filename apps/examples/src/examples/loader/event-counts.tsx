/**
 * Progressively load reaction, comment, repost and zap counts for a scrolling feed with the count service
 * @tags loader, count, nip-45, stress
 * @related loader/infinite-scroll, feed/loading-reactions
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Note } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import { ensureWebSocketURL, getDisplayName, getProfilePicture, normalizeURL } from "applesauce-core/helpers";
import {
  createCountService,
  type CountService,
  createEventLoaderForStore,
  createTimelineLoader,
  legacyReferenceCountMetric,
  reactionCountMetric,
  rootCommentCountMetric,
  type CountDiagnostic,
  type CountMetric,
  type CountState,
} from "applesauce-loaders/loaders";
import { use$, useRenderedContent, type ComponentMap } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { Heart, MessageSquare, Quote, Repeat2, Reply, Zap, type LucideIcon } from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";
import {
  asapScheduler,
  auditTime,
  BehaviorSubject,
  combineLatest,
  defer,
  EMPTY,
  ignoreElements,
  map,
  Observable,
  ReplaySubject,
  scan,
  share,
  startWith,
  Subject,
  subscribeOn,
  switchMap,
  tap,
  timer,
} from "rxjs";

import RelayPicker from "../../components/relay-picker";
import { historyWindows } from "../../extra/history-window";
import { lookupRelays$ } from "../../settings";
import { verifyEvent } from "../../extra/verifier";

const NOTES = { kinds: [1] };
// How far back in time each older page of the feed reaches
const STEP = 3 * 60 * 60;
// Load an older page when the last rendered row is this close to the end
const PREFETCH = 3;
// The fixed height of a grid row and the minimum width of a note column
const ROW_HEIGHT = 84;
const COLUMN_WIDTH = 340;
// The service gives up on a single relay after this long
const ATTEMPT_TIMEOUT = 5000;

const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
// This adapter creates its object store only when the database is first created.
const countCache = new Keyv({
  store: new KeyvIndexedDB({ dbName: "applesauce-example-counts", storeName: "counts" }),
});
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

const COUNT_RELAYS = ["wss://relay.ditto.pub/", "wss://relay.primal.net/", "wss://relay.nostr.net/"];
const settings$ = new BehaviorSubject({
  relays: COUNT_RELAYS,
  concurrency: 40,
  attemptTimeout: ATTEMPT_TIMEOUT,
  persistentCache: false,
});
const diagnostics$ = new Subject<CountDiagnostic>();
function buildCounts({ persistentCache, ...settings }: typeof settings$.value) {
  return createCountService(pool, {
    ...settings,
    cache: persistentCache ? countCache : undefined,
    ttl: () => 5 * 60_000,
    diagnostic: (event) => diagnostics$.next(event),
  });
}

const counts$ = settings$.pipe(
  switchMap(
    (settings) =>
      new Observable<CountService>((subscriber) => {
        const service = buildCounts(settings);
        subscriber.next(service);
        return () => service.stop();
      }),
  ),
  share({ connector: () => new ReplaySubject<CountService>(1), resetOnRefCountZero: true }),
);

// Built-in metrics plus custom ones with their COUNT filters
const METRICS: { label: string; icon: LucideIcon; metric: CountMetric }[] = [
  { label: "Reactions", icon: Heart, metric: reactionCountMetric },
  { label: "Comments", icon: MessageSquare, metric: rootCommentCountMetric },
  { label: "Replies", icon: Reply, metric: legacyReferenceCountMetric },
  {
    label: "Reposts",
    icon: Repeat2,
    metric: {
      id: "reposts:v1",
      filters: (target) => (target.address ? undefined : [{ kinds: [6, 16], "#e": [target.id] }]),
    },
  },
  {
    label: "Quotes",
    icon: Quote,
    metric: {
      id: "quotes:v1",
      filters: (target) => (target.address ? undefined : [{ kinds: [1], "#q": [target.id] }]),
    },
  },
  {
    label: "Zaps",
    icon: Zap,
    metric: {
      id: "zaps:v1",
      filters: (target) => (target.address ? undefined : [{ kinds: [9735], "#e": [target.id] }]),
    },
  },
];

type Stats = {
  gauges: Pick<CountDiagnostic, "active" | "requests" | "activeMetrics" | "cacheEntries">;
  events: Record<string, number>;
};
const EMPTY_STATS: Stats = {
  gauges: { active: 0, requests: 0, activeMetrics: 0, cacheEntries: 0 },
  events: {},
};
const reset$ = new Subject<void>();
const stats$ = reset$.pipe(
  startWith(undefined),
  switchMap(() =>
    diagnostics$.pipe(
      scan((stats: Stats, event: CountDiagnostic): Stats => {
        const { type, active, requests, activeMetrics, cacheEntries } = event;
        return {
          gauges: { active, requests, activeMetrics, cacheEntries },
          events: { ...stats.events, [type]: (stats.events[type] ?? 0) + 1 },
        };
      }, EMPTY_STATS),
      startWith(EMPTY_STATS),
    ),
  ),
  auditTime(100),
);

const more$ = new Subject<void>();

/** Loads kind 1 notes from one relay, reaching another step further back for each older page request */
function feed$(relay: string) {
  const loader = createTimelineLoader(pool, [relay], NOTES, { eventStore, limit: 100 });

  return defer(() => {
    const windows$ = historyWindows(more$, STEP).pipe(share({ connector: () => new ReplaySubject(1) }));
    const notes$ = windows$.pipe(
      switchMap(({ since }) => eventStore.timeline({ ...NOTES, since })),
      // Coalesce incoming events before casting and rendering the growing timeline.
      auditTime(16),
      castTimelineStream(Note, eventStore),
    );
    const status$ = loader.status$.pipe(
      map((statuses) => ({
        loading: statuses.length === 0 || statuses.some((status) => status.state === "loading"),
        error: statuses
          .filter((status) => status.state === "incomplete" && status.reason === "request")
          .map((status) => String(status.error ?? "Incomplete relay coverage"))
          .join("; "),
      })),
      startWith({ loading: true, error: "" }),
    );

    return combineLatest([notes$, status$, loader(windows$).pipe(ignoreElements(), startWith(null))]).pipe(
      map(([notes, status]) => ({ notes, ...status })),
    );
  });
}

function describe(label: string, state: CountState | undefined) {
  if (state?.value !== undefined) {
    const origin = state.origin?.relay;
    return `${label}: ${state.value} from ${origin}${state.fresh ? "" : " (stale)"}`;
  }
  if (!state || state.refreshing) return `${label}: loading`;

  const failure = state.failure instanceof Error ? state.failure.message : String(state.failure ?? "no answer");
  return `${label}: unavailable, ${failure}`;
}

const MetricCount = memo(function MetricCount({ note, entry }: { note: Note; entry: (typeof METRICS)[number] }) {
  // Subscribing starts the request, unmounting cancels it whether it is waiting for capacity or in flight
  const state = use$(
    () =>
      counts$.pipe(
        switchMap((counts) => counts.event(note.event).metric(entry.metric)),
        // Skip demand during use$'s synchronous render probe; subscribe after commit.
        subscribeOn(asapScheduler),
      ),
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
});

/** Uses a stable relay color across counts, grouping changes, and reloads */
const RelayColor = memo(function RelayColor({ relay }: { relay: string }) {
  const url = normalizeURL(ensureWebSocketURL(relay.trim()));
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
});

const excerptComponents: ComponentMap = {
  text: ({ node }) => <span>{node.value}</span>,
  link: ({ node }) => (
    <a href={node.href} target="_blank" rel="noreferrer">
      {node.value}
    </a>
  ),
  hashtag: ({ node }) => <span>#{node.hashtag}</span>,
  mention: ({ node }) => <span>@{node.encoded.slice(0, 12)}…</span>,
};

const FeedNote = memo(function FeedNote({ note }: { note: Note }) {
  const profile = use$(note.author.profile$);
  const content = useRenderedContent(note.event, excerptComponents);
  const time = useMemo(() => new Date(note.event.created_at * 1000).toLocaleTimeString(), [note.event.created_at]);

  return (
    <article className="min-w-0 border-b border-r border-base-300 px-3 py-2" style={{ height: ROW_HEIGHT }}>
      <div className="flex items-center gap-2">
        <img
          src={getProfilePicture(profile, `https://robohash.org/${note.author.pubkey}.png`)}
          className="h-5 w-5 shrink-0 rounded-full"
          alt=""
        />
        <span className="min-w-0 truncate">{getDisplayName(profile)}</span>
        <time className="ml-auto shrink-0 text-sm text-base-content/60">{time}</time>
      </div>
      <p className="truncate text-sm text-base-content/70">{content}</p>
      <div className="mt-1 flex gap-3 overflow-hidden">
        {METRICS.map((entry) => (
          <MetricCount key={entry.metric.id} note={note} entry={entry} />
        ))}
      </div>
    </article>
  );
});

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

const Feed = memo(function Feed({ notes, loading }: { notes: Note[]; loading: boolean }) {
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const columns = use$(() => columns$(scroller), [scroller]) ?? 1;
  const rowCount = Math.ceil(notes.length / columns);
  const getItemKey = useCallback((index: number) => notes[index * columns]?.id ?? index, [notes, columns]);

  // Virtualize rows of notes, each row is a fixed height so nothing needs measuring
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller,
    getItemKey,
    estimateSize: () => ROW_HEIGHT,
    // Keep a small buffer to avoid subscription churn when scrolling across row boundaries.
    overscan: 2,
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
});

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

function RequestStats() {
  const stats = use$(stats$) ?? EMPTY_STATS;
  const counts = use$(counts$);
  const total = (type: string) => stats.events[type] ?? 0;
  const { active, requests, activeMetrics, cacheEntries } = stats.gauges;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Requests</h2>
        <div className="flex gap-2">
          <button
            className="btn btn-sm"
            onClick={() => void counts?.invalidate().catch(console.error)}
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
          ["Outstanding", requests],
          ["Observed metrics", activeMetrics],
          ["Cached results", cacheEntries],
        ].map(([label, value]) => (
          <div key={label} className="border-base-300 p-3 odd:border-r [&:nth-child(-n+2)]:border-b">
            <div className="text-2xl font-semibold">{value}</div>
            <div className="text-sm text-base-content/70">{label}</div>
          </div>
        ))}
      </div>

      <StatTable title="Scheduler" rows={[["Started", total("dispatched"), "Requests admitted and sent"]]} />
      <StatTable
        title="Cache"
        rows={[
          [
            "Fresh hits",
            total("cache-hit"),
            "Fresh counts reused from memory or browser storage without a relay request",
          ],
          [
            "Persistent hits",
            total("persistent-cache-hit"),
            "Counts restored from browser storage, including stale counts",
          ],
        ]}
      />
    </section>
  );
}

function CountRelay({ relay, onRemove }: { relay: string; onRemove: () => void }) {
  const icon = use$(() => pool.relay(relay).icon$, [relay]);
  const name = use$(() => pool.relay(relay).name$, [relay]);

  return (
    <li className="flex items-center gap-2 border-b border-base-300 py-2 last:border-b-0">
      <RelayColor relay={relay} />
      <img src={icon} alt="" className="size-5 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 truncate">{name?.trim() || new URL(relay).hostname}</div>
      <button className="btn btn-sm btn-ghost" onClick={onRemove} aria-label={`Remove ${relay}`}>
        Remove
      </button>
    </li>
  );
}

function CountSettings() {
  const settings = use$(settings$);
  const [draft, setDraft] = useState(settings$.value);
  const [error, setError] = useState("");
  const apply = () => {
    try {
      if (!draft.relays.length) throw Error("Add at least one trusted relay");
      const next = draft;
      const validation = buildCounts(next);
      validation.stop();
      reset$.next();
      settings$.next(next);
      setError("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid settings");
    }
  };
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Trusted COUNT relays</h2>
      <p className="text-sm text-base-content/70">
        One relay answers each metric. Faster available relays receive more work; answers may differ between relays.
      </p>
      <ul>
        {draft.relays.map((relay) => (
          <CountRelay
            key={relay}
            relay={relay}
            onRemove={() =>
              setDraft((current) => ({ ...current, relays: current.relays.filter((url) => url !== relay) }))
            }
          />
        ))}
      </ul>
      <div className="flex flex-col gap-1 text-sm">
        <span>Add relay</span>
        <RelayPicker
          key={draft.relays.join("|")}
          value=""
          className="w-full"
          supportedNips={["45"]}
          onChange={(value) => {
            const relay = normalizeURL(ensureWebSocketURL(value));
            setDraft((current) => ({
              ...current,
              relays: current.relays.includes(relay) ? current.relays : [...current.relays, relay],
            }));
          }}
        />
        <p className="text-xs text-base-content/60">
          Recommendations support NIP-45 according to the selected monitor.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(
          [
            ["concurrency", "Maximum per relay"],
            ["attemptTimeout", "Attempt budget (ms)"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1 text-sm">
            {label}
            <input
              className="input w-full"
              type="number"
              min={1}
              max={key === "attemptTimeout" ? 2_147_483_647 : Number.MAX_SAFE_INTEGER}
              step={1}
              value={draft[key]}
              onChange={(e) => {
                const value = e.target.valueAsNumber;
                if (Number.isSafeInteger(value) && value > 0) setDraft({ ...draft, [key]: value });
              }}
            />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-3 text-sm">
        <input
          type="checkbox"
          className="toggle toggle-primary"
          checked={draft.persistentCache}
          onChange={(event) => setDraft({ ...draft, persistentCache: event.target.checked })}
        />
        Persist counts in browser storage
      </label>
      <p className="text-xs text-base-content/60">
        Enable and apply to reuse counts across reloads. Disabling leaves saved counts intact. Counts are always cached
        in memory while this example is open.
      </p>
      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}
      <button className="btn btn-primary" onClick={apply}>
        Apply settings
      </button>
      <p className="text-sm text-base-content/60">
        Starts with up to two requests per relay and adapts toward a maximum of {settings.concurrency}. Every observed
        metric remains requested until it is answered or its component unmounts.
      </p>
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
        {feed?.error && (
          <p role="alert" className="border-b border-base-300 p-3 text-error">
            Feed relay: {feed.error}
          </p>
        )}
        {feed && !feed.loading && !feed.error && feed.notes.length === 0 && (
          <p className="p-4 text-base-content/70">No notes in this time range yet, load older notes below.</p>
        )}
        <Feed notes={feed?.notes ?? []} loading={feed?.loading ?? true} />
      </div>
      <aside className="flex min-h-0 w-[28rem] max-w-[45vw] flex-col gap-6 overflow-y-auto border-l border-base-300 p-4">
        <CountSettings />
        <RequestStats />
      </aside>
    </div>
  );
}
