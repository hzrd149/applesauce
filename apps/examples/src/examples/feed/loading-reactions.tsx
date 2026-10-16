/**
 * Stress-test batched reaction event loading for a dense, virtualized relay feed
 * @tags nip-25, feed, reactions, loading, stress
 * @related loader/event-counts, feed/reactions-timeline
 */
import { useVirtualizer } from "@tanstack/react-virtual";
import { Note } from "applesauce-common/casts";
import { ReactionsModel } from "applesauce-common/models";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore } from "applesauce-core";
import { getDisplayName } from "applesauce-core/helpers";
import { createEventLoaderForStore, createTagValueLoader } from "applesauce-loaders/loaders";
import type { NostrRequest } from "applesauce-loaders";
import { use$ } from "applesauce-react/hooks";
import { RelayPool } from "applesauce-relay";
import { useRef, useState } from "react";
import {
  auditTime,
  BehaviorSubject,
  catchError,
  defer,
  endWith,
  finalize,
  ignoreElements,
  map,
  merge,
  Observable,
  of,
  startWith,
  tap,
} from "rxjs";

import RelayPicker from "../../components/relay-picker";
import NoteContent from "../../components/note-content";
import { relayTimeline } from "../../extra/relay-timeline";
import { lookupRelays$ } from "../../settings";

const NOTES = { kinds: [1] };
const ROW_HEIGHT = 76;
const eventStore = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$ });

const stats$ = new BehaviorSubject({
  requests: 0,
  active: 0,
  peak: 0,
  values: 0,
  arrivals: 0,
  cacheQueries: 0,
  cacheEvents: 0,
  consumers: 0,
  failures: 0,
  lastError: "",
});
function record(patch: Partial<typeof stats$.value>) {
  stats$.next({ ...stats$.value, ...patch });
}

// Instrument the actual transport, not the number of callers entering the batching queue.
const request: NostrRequest = (relays, filters) =>
  defer(() => {
    const active = stats$.value.active + 1;
    record({
      requests: stats$.value.requests + 1,
      active,
      peak: Math.max(stats$.value.peak, active),
      values: stats$.value.values + filters.reduce((sum, filter) => sum + (filter["#e"]?.length ?? 0), 0),
    });
    return defer(() => pool.request(relays, filters)).pipe(
      tap(() => record({ arrivals: stats$.value.arrivals + 1 })),
      finalize(() => record({ active: stats$.value.active - 1 })),
    );
  });

// Use the generic loader here to demonstrate force and cache provenance for kind 7 events.
const reactions = createTagValueLoader(request, "e", {
  kinds: [7],
  eventStore,
  bufferTime: 150,
  bufferSize: 200,
  maxConcurrentBatches: 4,
  relayConcurrency: 8,
  requestTimeout: 5000,
  cacheRequest: (filters) => {
    const events = eventStore.getByFilters(filters);
    record({ cacheQueries: stats$.value.cacheQueries + 1, cacheEvents: stats$.value.cacheEvents + events.length });
    return events;
  },
  onError: (error, source) =>
    record({
      failures: stats$.value.failures + 1,
      lastError: `${source.source === "relay" ? source.relay : source.source}: ${String(error)}`,
    }),
});

function loadReactions(id: string, relay: string, force: boolean) {
  return defer(() => {
    record({ consumers: stats$.value.consumers + 1 });
    return reactions({ value: id, relays: [relay], force }).pipe(
      finalize(() => record({ consumers: stats$.value.consumers - 1 })),
    );
  });
}

function FeedNote({
  note,
  relay,
  refresh,
  paused,
  duplicate,
}: {
  note: Note;
  relay: string;
  refresh: number;
  paused: boolean;
  duplicate: boolean;
}) {
  const mountedAt = useRef(refresh);
  const profile = use$(note.author.profile$);
  // Rendering comes from the store; every cache and network arrival reaches it before UI throttling.
  const groups = use$(
    () =>
      eventStore.model(ReactionsModel, note.event).pipe(
        map((events) => {
          const counts = new Map<string, number>();
          for (const event of events) counts.set(event.content || "+", (counts.get(event.content || "+") ?? 0) + 1);
          return { total: events.length, entries: [...counts].sort((a, b) => b[1] - a[1]) };
        }),
        auditTime(100),
      ),
    [note],
  );
  const status = use$(
    () =>
      paused
        ? of("paused")
        : merge(
            loadReactions(note.id, relay, refresh > mountedAt.current),
            // A second consumer asks for the same pointer; the loader still batches/deduplicates the relay query.
            duplicate ? loadReactions(note.id, relay, refresh > mountedAt.current) : of(),
          ).pipe(
            ignoreElements(),
            endWith("settled"),
            startWith("loading"),
            catchError((error) => of(String(error))),
          ),
    [note.id, relay, refresh, paused, duplicate],
  );

  const loading = !status || status === "loading";
  const finished = status === "settled";
  const stateColor = loading
    ? "text-primary border-primary/40"
    : finished
      ? "text-success border-success/40"
      : status === "paused"
        ? "text-base-content/70 border-base-300"
        : "text-error border-error/40";

  return (
    <article className="min-w-0 border-b border-r border-base-300 px-3 py-1" style={{ height: ROW_HEIGHT }}>
      <div className="flex h-7 items-center justify-between gap-2" aria-label="Loaded reactions">
        <span className="min-w-0 truncate">
          <strong className="text-lg tabular-nums">{groups?.total ?? "—"}</strong>
          <span className="ml-1 text-sm font-medium">reactions loaded</span>
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 rounded border px-1.5 text-sm font-semibold ${stateColor}`}
          role="status"
          title={status}
        >
          {loading && <span className="loading loading-spinner h-3 w-3" aria-hidden="true" />}
          {loading ? "Loading" : finished ? "Loaded" : status === "paused" ? "Paused" : "Failed"}
        </span>
      </div>
      <div className="flex h-5 items-center gap-3 overflow-hidden whitespace-nowrap text-sm font-medium">
        {groups?.entries.slice(0, 4).map(([content, count]) => (
          <span key={content} className="max-w-24 truncate" title={content}>
            {content} <span className="tabular-nums">{count}</span>
          </span>
        ))}
        {!groups?.total && (
          <span className="text-base-content/60">
            {loading ? "Fetching reaction events…" : finished ? "No reactions returned" : "No reactions loaded"}
          </span>
        )}
      </div>
      <div
        className="flex h-5 min-w-0 items-center gap-2 overflow-hidden text-sm text-base-content/50"
        title={`${getDisplayName(profile, note.author.pubkey)}: ${note.event.content}`}
      >
        <span className="max-w-24 shrink-0 truncate">{getDisplayName(profile, note.author.pubkey.slice(0, 12))}</span>
        <span aria-hidden="true">·</span>
        <NoteContent event={note.event} maxLength={200} className="min-w-0 flex-1 line-clamp-1 break-all" />
      </div>
    </article>
  );
}

function Feed({
  relay,
  paused,
  duplicate,
  refresh,
}: {
  relay: string;
  paused: boolean;
  duplicate: boolean;
  refresh: number;
}) {
  const [limit, setLimit] = useState(500);
  const feed = use$(() => relayTimeline(eventStore, pool, [relay], { ...NOTES, limit }), [relay, limit]);
  const notes = use$(() => of(feed?.events ?? []).pipe(castTimelineStream(Note, eventStore)), [feed?.events]) ?? [];
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const columns =
    use$(
      () =>
        new Observable<number>((observer) => {
          if (!scroller) {
            observer.next(1);
            return;
          }
          const measure = () => observer.next(Math.max(1, Math.floor(scroller.clientWidth / 320)));
          const resize = new ResizeObserver(measure);
          resize.observe(scroller);
          measure();
          return () => resize.disconnect();
        }),
      [scroller],
    ) ?? 1;
  const loading = !feed || feed.status === "loading";
  const virtualizer = useVirtualizer({
    count: Math.ceil(notes.length / columns),
    getScrollElement: () => scroller,
    getItemKey: (index) => notes[index * columns]?.id ?? index,
    estimateSize: () => ROW_HEIGHT,
    overscan: 0,
  });
  const rows = virtualizer.getVirtualItems();
  const visible = rows.reduce((sum, row) => sum + Math.min(columns, notes.length - row.index * columns), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 px-3 py-2 text-sm">
        <span>
          {notes.length} notes · {visible} on screen
        </span>
        {loading && <span role="status">Loading notes…</span>}
        <button className="btn btn-sm ml-auto" disabled={loading} onClick={() => setLimit(limit + 500)}>
          Load more notes
        </button>
      </div>
      {feed?.errors.map((error) => (
        <p key={error} role="alert" className="px-3 py-2 text-error">
          {error}
        </p>
      ))}
      {!loading && notes.length === 0 && (
        <p className="p-3">No notes loaded. Try loading more notes or another relay.</p>
      )}
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
                <FeedNote key={note.id} {...{ note, relay, paused, duplicate, refresh }} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RequestStats() {
  const stats = use$(() => stats$.pipe(auditTime(100), startWith(stats$.value)), []) ?? stats$.value;
  const rows = [
    ["Subscribed consumers", stats.consumers],
    ["Active relay requests", stats.active],
    ["Peak relay requests", stats.peak],
    ["Relay requests started", stats.requests],
    ["Tag values requested", stats.values],
    ["Reaction arrivals", stats.arrivals],
    ["Cache queries", stats.cacheQueries],
    ["Cached events returned", stats.cacheEvents],
    ["Source failures", stats.failures],
  ];
  return (
    <details className="border-t border-base-300 p-3" open>
      <summary className="cursor-pointer font-semibold">
        Reaction loader activity · {stats.active} active · {stats.requests} requests
      </summary>
      <button
        className="btn btn-sm mt-2"
        onClick={() =>
          record({
            requests: 0,
            peak: stats$.value.active,
            values: 0,
            arrivals: 0,
            cacheQueries: 0,
            cacheEvents: 0,
            failures: 0,
            lastError: "",
          })
        }
      >
        Reset totals
      </button>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-5">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-base-content/60">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {stats.lastError && (
        <p role="alert" className="mt-2 break-all text-sm text-warning">
          Partial results: {stats.lastError}
        </p>
      )}
    </details>
  );
}

export default function FeedWithReactions() {
  const [relay, setRelay] = useState("wss://pyramid.fiatjaf.com/");
  const [paused, setPaused] = useState(false);
  const [duplicate, setDuplicate] = useState(false);
  const [refresh, setRefresh] = useState(0);
  return (
    <div className="flex min-h-0 grow flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-base-300 p-2">
        <RelayPicker value={relay} onChange={setRelay} className="min-w-64 flex-1" />
        <button className="btn btn-sm" onClick={() => setPaused(!paused)}>
          {paused ? "Resume reactions" : "Pause new loads"}
        </button>
        <button className="btn btn-sm" disabled={paused} onClick={() => setRefresh(refresh + 1)}>
          Refresh visible from relays
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={duplicate}
            onChange={(e) => setDuplicate(e.target.checked)}
          />
          Two consumers per note
        </label>
      </div>
      <p className="border-b border-base-300 px-3 py-1 text-sm text-base-content/60">
        Actual reaction events for visible notes. Loaded totals are partial; requests settle after completion or a
        5-second deadline.
      </p>
      <Feed key={relay} {...{ relay, paused, duplicate, refresh }} />
      <RequestStats />
    </div>
  );
}
