/**
 * Infinite scroll a user's notes from their NIP-65 outbox relays without jumps, driven by intersection observers
 * @tags loader, timeline, outbox, infinite-scroll, stress
 * @related loader/timeline-scrubber, outbox/social-feed
 */
import { castUser, Note } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import { unixNow } from "applesauce-core/helpers";
import { defined } from "applesauce-core/observable";
import {
  createEventLoaderForStore,
  createOutboxTimelineLoader,
  TimelineStatus,
  TimelineWindow,
} from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { ignoreUnhealthyRelays, RelayLiveness, RelayPool } from "applesauce-relay";
import { useCallback, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  animationFrameScheduler,
  auditTime,
  BehaviorSubject,
  combineLatest,
  defer,
  distinctUntilChanged,
  filter,
  ignoreElements,
  map,
  merge,
  observeOn,
  of,
  shareReplay,
  skip,
  switchMap,
  take,
  tap,
  throttleTime,
} from "rxjs";

import NoteContent from "../../components/note-content";
import PubkeyPicker from "../../components/pubkey-picker";
import { MonitorSnapshot, TimelineMonitor } from "../../helpers/timeline-stress";
import { lookupRelays$ } from "../../settings";

// Very active users to scroll through, any other user can be picked below
const PRESETS = [
  { name: "fiatjaf", pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d" },
  { name: "Gigi", pubkey: "6e468422dfb74a5738702a8823b9b28168abab8655faacb6853cd0ee15deee93" },
  { name: "ODELL", pubkey: "04c915daefee38317fa734444acee390a8269fe5810b2241e5e6dd343dfbecc9" },
  { name: "jb55", pubkey: "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245" },
  { name: "hzrd149", pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5" },
];
const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const OVERVIEWS = [
  ["1w", 7 * DAY],
  ["30d", 30 * DAY],
  ["90d", 90 * DAY],
  ["1y", 365 * DAY],
] as const;
// How many buffered notes to add when a rendered edge comes near the viewport
const PAGE = 20;
// How far past a rendered edge to load when nothing is buffered there, doubled while extensions find few notes
const STEP = 6 * HOUR;
// Start loading this far before a rendered edge scrolls into view
const MARGIN = "1500px";
const NOTES = { kinds: [1] };
// SVG units along the minimap time axis
const HEIGHT = 1000;
const COLUMN = 10;

// Skip signature checks, this example measures loading not verification
const eventStore = new EventStore({ verifyEvent: () => true });
const pool = new RelayPool();
// Tracks failing relays with a backoff so they drop out of the outbox relay set until they recover
const liveness = new RelayLiveness();
liveness.connectToPool(pool);
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

// Records every REQ the loader sends so the minimap can show it
const monitor = new TimelineMonitor();
const request = monitor.instrument((relays, filters) => pool.request(relays, filters));

type Edges = { top: boolean; bottom: boolean };

/** Tracks which notes and edge sentinels are near the viewport of one scroll container */
function createScrollTracker(margin: string) {
  const items = new Set<HTMLElement>();
  const visible = new Set<Element>();
  const sentinels = new Map<Element, keyof Edges>();
  const viewport$ = new BehaviorSubject<TimelineWindow | undefined>(undefined);
  const edges$ = new BehaviorSubject<Edges>({ top: false, bottom: false });
  let root: HTMLElement | undefined;
  let itemObserver: IntersectionObserver | undefined;
  let edgeObserver: IntersectionObserver | undefined;

  // The visible time range is the span of created_at timestamps of the notes on screen
  const update = () => {
    const times = Array.from(visible, (el) => Number((el as HTMLElement).dataset.createdAt));
    const next = times.length ? { since: Math.min(...times), until: Math.max(...times) } : undefined;
    if (next?.since !== viewport$.value?.since || next?.until !== viewport$.value?.until) viewport$.next(next);
  };

  const sentinel = (edge: keyof Edges) => (el: HTMLElement | null) => {
    if (!el) return;
    sentinels.set(el, edge);
    edgeObserver?.observe(el);
    return () => {
      sentinels.delete(el);
      edgeObserver?.unobserve(el);
    };
  };

  return {
    viewport$,
    edges$,
    get root() {
      return root;
    },
    /** Returns the topmost note on screen, used to keep it in place while notes are added above it */
    anchor() {
      let top: HTMLElement | undefined;
      for (const el of visible) if (!top || (el as HTMLElement).offsetTop < top.offsetTop) top = el as HTMLElement;
      return top;
    },
    /** Ref callback for the scroll container, the observers need it as their root */
    container: (el: HTMLDivElement | null) => {
      if (!el) return;
      root = el;
      itemObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) visible.add(entry.target);
            else visible.delete(entry.target);
          }
          update();
        },
        { root: el },
      );
      edgeObserver = new IntersectionObserver(
        (entries) => {
          const edges = { ...edges$.value };
          for (const entry of entries) edges[sentinels.get(entry.target)!] = entry.isIntersecting;
          edges$.next(edges);
        },
        { root: el, rootMargin: `${margin} 0px` },
      );
      // Children mount before their container, so observe everything that registered early
      for (const item of items) itemObserver.observe(item);
      for (const s of sentinels.keys()) edgeObserver.observe(s);
      return () => {
        itemObserver?.disconnect();
        edgeObserver?.disconnect();
        itemObserver = edgeObserver = root = undefined;
        visible.clear();
        update();
      };
    },
    /** Ref callback for a note with a `data-created-at` timestamp */
    item: (el: HTMLElement | null) => {
      if (!el) return;
      items.add(el);
      itemObserver?.observe(el);
      return () => {
        items.delete(el);
        visible.delete(el);
        itemObserver?.unobserve(el);
        update();
      };
    },
    /** Ref callback for the sentinel above the newest rendered note */
    top: sentinel("top"),
    /** Ref callback for the sentinel below the oldest rendered note */
    bottom: sentinel("bottom"),
  };
}

const tracker = createScrollTracker(MARGIN);

// The rendered time range. It grows as soon as the fastest relay has loaded a window, slower relays stream into it
const range$ = new BehaviorSubject<TimelineWindow>({ since: unixNow(), until: unixNow() });
// The notes on screen, only ever changed by render() so every change keeps the reader's place
const notes$ = new BehaviorSubject<Note[]>([]);
// The time the loader started, newer notes arrive through the live subscription
const head$ = new BehaviorSubject(unixNow());
const step$ = new BehaviorSubject(STEP);

/** Renders a new list of notes, keeping the topmost visible note at the same position on screen */
function render(notes: Note[]) {
  const anchor = tracker.anchor();
  const top = anchor?.getBoundingClientRect().top;
  // Render synchronously so the scroll position is corrected before the browser paints
  flushSync(() => notes$.next(notes));
  const root = tracker.root;
  if (root && anchor?.isConnected && top !== undefined) root.scrollTop += anchor.getBoundingClientRect().top - top;
}

/** Scrolls to a time inside the rendered range, or restarts the list at that time */
function seek(t: number) {
  const root = tracker.root;
  if (!root) return;
  const range = range$.value;
  if (t >= range.until && range.until >= head$.value) root.scrollTop = 0;
  else if (t >= range.since && t <= range.until) {
    const notes = root.querySelectorAll<HTMLElement>("[data-created-at]");
    const note = Array.from(notes).find((el) => Number(el.dataset.createdAt) <= t);
    root.scrollTop = note ? note.offsetTop : root.scrollHeight;
  } else {
    // The old notes are removed on the next frame, so render() has nothing to anchor and the list starts at the top
    step$.next(STEP);
    range$.next({ since: Math.round(t), until: Math.round(t) });
    root.scrollTop = 0;
  }
}

/** Checks that at least one relay has finished loading the visible part of a window */
const ready = (window: TimelineWindow) => (statuses: TimelineStatus[]) =>
  statuses.some(
    (status) =>
      status.window.since === window.since &&
      status.window.until === Math.min(window.until, unixNow()) &&
      status.state !== "loading",
  );

/** Loads a user's notes around the viewport, grows the rendered range and follows new notes live */
function feed(pubkey: string) {
  return defer(() => {
    // Start from an empty store so earlier runs can't hide gaps
    monitor.reset();
    eventStore.removeByFilters({ ...NOTES, authors: [pubkey] });
    const head = unixNow();
    head$.next(head);
    step$.next(STEP);
    range$.next({ since: head, until: head });

    const outboxes$ = castUser(pubkey, eventStore).outboxes$.pipe(defined(), ignoreUnhealthyRelays(liveness));
    const loader = createOutboxTimelineLoader(
      request,
      outboxes$.pipe(map((relays) => Object.fromEntries(relays.map((relay) => [relay, [{ pubkey }]])))),
      NOTES,
      // The loader buffers a page of events past each visible edge and reports failing relays to liveness
      { eventStore, liveness },
    );

    // Extend an edge by the next page of notes the loader has already buffered, at most one time step so the
    // range never leaps over unloaded time to notes left in the store by an earlier jump
    const older = (range: TimelineWindow, step: number) => {
      const notes = eventStore.getByFilters({ ...NOTES, authors: [pubkey], until: range.since - 1, limit: PAGE });
      const page = notes.length === PAGE ? Math.min(...notes.map((n) => n.created_at)) : 0;
      return Math.max(0, page, range.since - step);
    };
    const newer = (range: TimelineWindow, step: number) => {
      const notes = eventStore.getByFilters({ ...NOTES, authors: [pubkey], since: range.until + 1, until: head });
      const times = notes.map((n) => n.created_at).sort((a, b) => a - b);
      return Math.min(head, times[PAGE - 1] ?? Infinity, range.until + step);
    };

    // Load the notes on screen, reaching past a rendered edge when its sentinel is near the viewport
    const windows$ = combineLatest([tracker.viewport$, tracker.edges$, range$, step$]).pipe(
      map(([viewport, edges, range, step]) => {
        // A jump replaces the range before the old notes unmount, so a viewport outside the range is stale
        const visible =
          viewport && viewport.since >= range.since && viewport.until <= range.until ? viewport : undefined;
        return {
          since: edges.bottom || !visible ? older(range, step) : visible.since,
          // Only load newer time after a jump into the past, the live subscription covers notes after the head
          until: edges.top && visible && range.until < head ? newer(range, step) : (visible?.until ?? range.until),
        };
      }),
      distinctUntilChanged((a, b) => a.since === b.since && a.until === b.until),
      throttleTime(100, undefined, { leading: true, trailing: true }),
      shareReplay({ bufferSize: 1, refCount: true }),
    );

    // Grow the range once the fastest relay has loaded a window, never waiting on slow or offline relays
    const commits$ = windows$.pipe(
      switchMap((window) =>
        loader.status$.pipe(
          filter(ready(window)),
          take(1),
          map(() => window),
        ),
      ),
      // Leave the status emission before changing the range, which feeds a new window back into the loader
      observeOn(animationFrameScheduler),
      tap((window) => {
        const range = range$.value;
        const next = { since: Math.min(range.since, window.since), until: Math.max(range.until, window.until) };
        if (next.since === range.since && next.until === range.until) return;

        // Quiet periods add few notes, so reach further on the next extension
        const count = (r: TimelineWindow) => eventStore.getByFilters({ ...NOTES, authors: [pubkey], ...r }).length;
        step$.next(count(next) - count(range) < 20 ? Math.min(step$.value * 2, 365 * DAY) : STEP);
        range$.next(next);
      }),
    );

    // Render the notes in the range, batching streamed events into one anchored update per frame
    const list$ = range$.pipe(
      switchMap((r) => eventStore.timeline({ ...NOTES, authors: [pubkey], ...r })),
      castTimelineStream(Note),
      auditTime(0, animationFrameScheduler),
      tap(render),
    );

    // New notes go into the store, the list shows them when the reader asks
    const live$ = outboxes$.pipe(
      switchMap((relays) => pool.subscription(relays, { ...NOTES, authors: [pubkey], since: head }, { eventStore })),
    );

    return merge(loader.status$, merge(loader(windows$), commits$, list$, live$).pipe(ignoreElements()));
  });
}

const date = (t?: number) => (t === undefined ? "—" : new Date(t * 1000).toLocaleString());
const short = (relay: string) => relay.replace(/^wss:\/\//, "").replace(/\/$/, "");

export default function InfiniteScroll() {
  const [pubkey, setPubkey] = useState(PRESETS[0].pubkey);
  const [overview, setOverview] = useState(30 * DAY);
  const [reset, setReset] = useState(0);

  // Ignore the empty value of a cleared input
  const pick = useCallback((pk: string) => pk && setPubkey(pk), []);

  const statuses = use$(() => feed(pubkey), [pubkey, reset]) ?? [];
  const range = use$(range$);
  const head = use$(head$);
  const stats = use$(monitor.snapshot$);
  const relays = use$(() => castUser(pubkey, eventStore).outboxes$, [pubkey]) ?? [];
  const notes = use$(notes$);

  // Count live notes newer than the rendered range while the list is attached to the head
  const fresh =
    use$(
      () =>
        combineLatest([range$, head$]).pipe(
          switchMap(([r, h]) =>
            r.until >= h ? eventStore.timeline({ ...NOTES, authors: [pubkey], since: r.until + 1 }) : of([]),
          ),
          map((events) => events.length),
        ),
      [pubkey],
    ) ?? 0;

  // Add the new notes above the reader without moving them, then scroll up to reveal them
  const showNew = () => {
    notes$.pipe(skip(1), take(1)).subscribe(() => tracker.root?.scrollTo({ top: 0, behavior: "smooth" }));
    range$.next({ ...range$.value, until: unixNow() });
  };

  const requests = stats?.requests ?? [];
  const count = (state: string) => requests.filter((r) => r.state === state).length;
  const loading = statuses.filter((s) => s.state === "loading").length;

  return (
    <div className="flex min-h-0 grow flex-col gap-2 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <select
          className="select w-40"
          value={PRESETS.some((p) => p.pubkey === pubkey) ? pubkey : ""}
          onChange={(e) => pick(e.target.value)}
          aria-label="Preset user"
        >
          <option value="" disabled>
            Custom
          </option>
          {PRESETS.map((p) => (
            <option key={p.pubkey} value={p.pubkey}>
              {p.name}
            </option>
          ))}
        </select>
        <PubkeyPicker value={pubkey} onChange={pick} className="flex-1" />
        <div className="join">
          {OVERVIEWS.map(([label, span]) => (
            <button
              key={label}
              className={`btn join-item ${overview === span ? "btn-active" : ""}`}
              onClick={() => setOverview(span)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="btn btn-outline" onClick={() => setReset((n) => n + 1)}>
          Reset
        </button>
      </div>

      {/* One line, so a growing status never changes the height above the list */}
      <div className="flex gap-x-6 overflow-hidden whitespace-nowrap border-y border-base-300 py-2">
        <span>
          Rendered <strong>{notes.length}</strong> notes
        </span>
        <span>
          {date(range.since)} → {date(range.until)}
        </span>
        <span>
          {statuses.length ? (
            <>
              <strong>{statuses.length - loading}</strong>/{statuses.length} relays loaded
            </>
          ) : (
            "Finding outbox relays"
          )}
        </span>
        <span>
          REQs <strong>{count("active")}</strong> active / <strong>{count("complete")}</strong> complete /{" "}
          <strong>{count("cancelled")}</strong> cancelled / <strong>{count("error")}</strong> error
        </span>
        {statuses
          .filter((s) => s.state === "incomplete")
          .map((s) => (
            <span key={s.source} className="text-warning">
              {short(s.source)}: {String(s.error ?? "Incomplete")}
            </span>
          ))}
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {fresh > 0 && (
            <button className="btn btn-primary absolute top-2 left-1/2 z-10 -translate-x-1/2" onClick={showNew}>
              Show {fresh} new {fresh === 1 ? "note" : "notes"}
            </button>
          )}
          {/* Browser scroll anchoring is disabled so render() is the only thing moving the scroll position */}
          <div
            ref={tracker.container}
            className="relative min-h-0 flex-1 overflow-y-auto border border-base-300"
            style={{ overflowAnchor: "none" }}
          >
            <div ref={tracker.top} />
            {notes.map((note) => (
              <NoteItem key={note.id} note={note} />
            ))}
            <div ref={tracker.bottom} className="p-4 text-center">
              {range.since === 0 ? (notes.length ? "Beginning of history" : "No notes") : "Loading older notes…"}
            </div>
          </div>
        </div>
        <Minimap pubkey={pubkey} relays={relays} stats={stats} statuses={statuses} overview={overview} head={head} />
      </div>
    </div>
  );
}

/** A single note with its timestamp, tracked by the scroll observers */
function NoteItem({ note }: { note: Note }) {
  return (
    <article ref={tracker.item} data-created-at={note.event.created_at} className="border-b border-base-300 p-3">
      <time className="text-sm opacity-70">{note.createdAt.toLocaleString()}</time>
      <NoteContent event={note.event} />
    </article>
  );
}

type MinimapProps = {
  pubkey: string;
  relays: string[];
  stats?: MonitorSnapshot;
  statuses: TimelineStatus[];
  overview: number;
  head: number;
};

/** A vertical time scrollbar with REQ spans, notes and the prefetch buffer per relay, the rendered range and the visible notes */
function Minimap({ pubkey, relays, stats, statuses, overview, head }: MinimapProps) {
  const range = use$(range$);
  const viewport = use$(tracker.viewport$);
  const events = use$(() => eventStore.timeline({ ...NOTES, authors: [pubkey] }), [pubkey]) ?? [];
  // The span is frozen while dragging so the axis doesn't rescale under the pointer
  const dragging = useRef<number>(undefined);
  const unhealthy = use$(liveness.unhealthy$) ?? [];

  const end = Math.max(unixNow(), head);
  // The overview is the minimum span, it grows to keep the rendered range, visible notes and buffers on the map
  const oldest = Math.min(range.since, viewport?.since ?? range.since, ...statuses.map((s) => s.buffer.since));
  const span = dragging.current ?? Math.max(overview, Math.ceil((end - oldest) * 1.1));
  const start = end - span;
  const y = (t: number) => ((end - t) / span) * HEIGHT;
  const width = (relays.length + 1) * COLUMN;

  // Bin timestamps into rows so thousands of notes stay cheap to render
  const bins = (times: Iterable<number>) => {
    const rows = new Set<number>();
    for (const t of times) if (t >= start && t <= end) rows.add(Math.floor(y(t)));
    return [...rows];
  };

  const toTime = (el: Element, clientY: number) => {
    const rect = el.getBoundingClientRect();
    return Math.min(end, Math.max(start, end - ((clientY - rect.top) / rect.height) * span));
  };

  const column = (
    key: string,
    i: number,
    ticks: number[],
    reqs: MonitorSnapshot["requests"] = [],
    status?: TimelineStatus,
  ) => (
    <g key={key} transform={`translate(${i * COLUMN} 0)`}>
      <title>{key}</title>
      <line x1={COLUMN} x2={COLUMN} y1={0} y2={HEIGHT} className="text-base-300" stroke="currentColor" />
      {/* The range this relay is loading: the visible notes plus the prefetch buffer, filled while it loads */}
      {status && (
        <rect
          x={1}
          y={y(Math.min(status.buffer.until, end))}
          width={COLUMN - 2}
          height={Math.max(y(Math.max(status.buffer.since, start)) - y(Math.min(status.buffer.until, end)), 1)}
          className="text-secondary"
          fill="currentColor"
          fillOpacity={status.state === "prefetching" ? 0.3 : 0}
          stroke="currentColor"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {reqs.slice(-300).map((r) => {
        const from = Math.min(r.until ?? end, end);
        const to = Math.max(r.since ?? start, start);
        if (from < start) return null;
        const color = { active: "text-info", complete: "text-success", cancelled: "text-warning", error: "text-error" }[
          r.state
        ];
        return (
          <rect
            key={r.id}
            x={1}
            y={y(from)}
            width={COLUMN / 2 - 1}
            height={Math.max(y(to) - y(from), 1)}
            className={color}
            fill="currentColor"
            fillOpacity={r.state === "active" ? 0.6 : 0.25}
          />
        );
      })}
      {ticks.map((row) => (
        <rect
          key={row}
          x={COLUMN / 2}
          y={row}
          width={COLUMN / 2 - 1}
          height={1}
          className="text-base-content"
          fill="currentColor"
        />
      ))}
    </g>
  );

  return (
    <div className="flex w-56 shrink-0 flex-col border border-base-300">
      <div className="flex h-32 border-b border-base-300">
        {["store", ...relays].map((relay) => (
          <div
            key={relay}
            title={unhealthy.includes(relay) ? `${relay} (failing, skipped until it recovers)` : relay}
            className={`min-w-0 flex-1 truncate py-1 text-sm [writing-mode:vertical-rl] ${unhealthy.includes(relay) ? "text-error line-through" : ""}`}
          >
            {short(relay)}
          </div>
        ))}
      </div>
      <div className="border-b border-base-300 px-2 text-sm">Now</div>
      <svg
        viewBox={`0 0 ${width} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="min-h-0 w-full flex-1 cursor-ns-resize touch-none select-none"
        onPointerDown={(e) => {
          dragging.current = span;
          e.currentTarget.setPointerCapture(e.pointerId);
          seek(toTime(e.currentTarget, e.clientY));
        }}
        onPointerMove={(e) => dragging.current !== undefined && seek(toTime(e.currentTarget, e.clientY))}
        onPointerUp={() => (dragging.current = undefined)}
        onWheel={(e) => tracker.root?.scrollBy({ top: e.deltaY })}
      >
        {column("store", 0, bins(events.map((e) => e.created_at)))}
        {relays.map((relay, i) =>
          column(
            relay,
            i + 1,
            bins(stats?.received.get(relay)?.values() ?? []),
            stats?.requests.filter((r) => r.relay === relay),
            statuses.find((s) => s.source === relay),
          ),
        )}
        <rect
          x={0}
          y={y(range.until)}
          width={width}
          height={Math.max(y(range.since) - y(range.until), 1)}
          className="text-primary"
          fill="currentColor"
          fillOpacity={0.1}
        />
        {viewport && (
          <rect
            x={0}
            y={y(viewport.until)}
            width={width}
            height={Math.max(y(viewport.since) - y(viewport.until), 2)}
            className="text-base-content"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className="border-t border-base-300 px-2 text-sm">{new Date(start * 1000).toLocaleDateString()}</div>
      <div className="flex flex-wrap gap-x-3 border-t border-base-300 px-2 py-1 text-sm">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 bg-primary/20" /> Rendered
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 border-2 border-base-content" /> Visible
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 border border-secondary bg-secondary/30" /> Prefetch
        </span>
      </div>
    </div>
  );
}
