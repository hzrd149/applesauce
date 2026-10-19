import { logger as baseLogger, type Debugger } from "applesauce-core";
import { EventMemory } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { compileFilter, Filter, isFilterEqual, mergeFilters } from "applesauce-core/helpers/filter";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createFilterMap, FilterMap, OutboxMap } from "applesauce-core/helpers/relay-selection";
import { mapEventsToStore } from "applesauce-core/observable";
import {
  asapScheduler,
  auditTime,
  BehaviorSubject,
  catchError,
  combineLatest,
  connect,
  defer,
  distinct,
  EMPTY,
  endWith,
  exhaustMap,
  filter,
  finalize,
  from,
  groupBy,
  ignoreElements,
  isObservable,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  OperatorFunction,
  repeat,
  ReplaySubject,
  scan,
  share,
  startWith,
  Subject,
  switchMap,
  takeUntil,
  takeWhile,
  tap,
  timeout,
  timer,
} from "rxjs";
import { makeCacheRequest } from "../helpers/cache.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, TimelessFilter, UpstreamPool } from "../types.js";

/** A finite inclusive time range to load */
export interface TimelineWindow {
  /** The oldest inclusive Unix timestamp */
  since: number;
  /** The newest inclusive Unix timestamp */
  until: number;
}

/** The coverage state of one source and filter for the latest visible window */
export interface TimelineStatus {
  /** The relay URL or cache identifier */
  source: string;
  /** The timeless filter being loaded */
  filter: TimelessFilter;
  /** The current visible range */
  window: TimelineWindow;
  /** The visible window plus its prefetch buffer, growing as older pages arrive */
  buffer: TimelineWindow;
  /** The visible coverage or background loading state */
  state: "loading" | "covered" | "prefetching" | "incomplete" | "removed";
  /** The reason visible coverage is incomplete */
  reason?: "request" | "boundary";
  /** The failure or unpageable timestamp that prevented complete coverage */
  error?: unknown;
}

/** A loader that follows explicit windows until its subscriber disconnects */
export interface TimelineLoader {
  /** Loads a finite range or follows a stream of changing ranges */
  (windows: TimelineWindow | Observable<TimelineWindow>): Observable<NostrEvent>;
  /** The latest coverage status for each source and filter */
  status$: Observable<TimelineStatus[]>;
}

/** A tracker that records relay request outcomes, such as `RelayLiveness` from applesauce-relay */
export interface TimelineLivenessTracker {
  /** Records a failed request to a relay */
  recordFailure(relay: string): void;
  /** Classifies a request error before recording transport failure when supported */
  recordRequestFailure?(relay: string, error: unknown, startedAt?: number): void;
  /** Records a completed request to a relay */
  recordSuccess(relay: string): void;
}

/** Options for loading and buffering timeline windows */
export interface CommonTimelineLoaderOptions {
  /** The maximum events requested per filter in one network batch, default 100 */
  limit?: number;
  /** The number of events to buffer past each side of the visible window per source and filter, default the limit; zero disables prefetch */
  prefetch?: number;
  /** The delay in milliseconds before retrying a failed range, doubled for each consecutive failure up to five minutes, default 5000 */
  retryDelay?: number;
  /** The time in milliseconds a source may stay silent across requests before it is treated as failing, default 10000 */
  responseTimeout?: number;
  /** A tracker receiving relay request failures and successes, so failing relays can be removed from the relay set */
  liveness?: TimelineLivenessTracker;
  /** The logger to extend */
  logger?: Debugger;
  /** A callback receiving coverage changes for each source and filter */
  onStatus?: (status: TimelineStatus) => void;
}

/** Options for timeline loaders with a store and optional cache */
export interface TimelineLoaderOptions extends CommonTimelineLoaderOptions {
  /** A method used to load timeline events from a cache */
  cache?: CacheRequest;
  /** The event store receiving all incoming events */
  eventStore?: Parameters<typeof mapEventsToStore>[0];
}

type Range = TimelineWindow;
type FiltersRequest = (filters: Filter[]) => Observable<NostrEvent>;

type FilterState = {
  filter: TimelessFilter;
  // Sorted, non-overlapping intervals established by completed requests.
  covered: Range[];
  boundaries: Map<number, Set<string>>;
  blocked: Set<number>;
  failures: { range: Range; error: unknown; retryAt: number }[];
  // Sorted timestamps of every received event, used to count the events buffered past the visible window.
  ids: Set<string>;
  times: number[];
  // The estimated newer buffer, relays cannot page forward to find its edge exactly.
  ahead?: Range;
};

type Tracker = { success(): void; failure(error: unknown, startedAt: number): void };

// The longest delay between retries of a failing source
const MAX_RETRY_DELAY = 5 * 60_000;

type FilterChange = { relay: string; filters?: TimelessFilter | TimelessFilter[] };

type ActiveRequest = { range: Range; prefetch: boolean; cancel$: ReplaySubject<void> };

function overlaps(a: Range, b: Range) {
  return a.since <= b.until && a.until >= b.since;
}

function options(opts?: CommonTimelineLoaderOptions) {
  const limit = opts?.limit ?? 100;
  const prefetch = opts?.prefetch ?? limit;
  const retryDelay = opts?.retryDelay ?? 5000;
  const responseTimeout = opts?.responseTimeout ?? 10_000;
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Timeline limit must be a positive integer");
  if (!Number.isSafeInteger(prefetch) || prefetch < 0)
    throw new Error("Timeline prefetch must be a non-negative integer");
  if (!Number.isFinite(retryDelay) || retryDelay <= 0) throw new Error("Timeline retry delay must be positive");
  if (!Number.isFinite(responseTimeout) || responseTimeout <= 0)
    throw new Error("Timeline response timeout must be positive");
  return { limit, prefetch, retryDelay, responseTimeout };
}

/** Returns the index of the first timestamp greater than or equal to t */
function lowerBound(times: number[], t: number) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function record(state: FilterState, event: NostrEvent) {
  if (state.ids.has(event.id)) return;
  state.ids.add(event.id);
  state.times.splice(lowerBound(state.times, event.created_at), 0, event.created_at);
}

function normalize(window: TimelineWindow): Range {
  if (
    !window ||
    !Number.isSafeInteger(window.since) ||
    window.since < 0 ||
    !Number.isSafeInteger(window.until) ||
    window.since > window.until
  )
    throw new Error("Timeline windows require finite integer since <= until bounds");
  return { since: window.since, until: Math.min(window.until, unixNow()) };
}

function missing(range: Range, covered: Range[]): Range[] {
  let since = range.since;
  const gaps: Range[] = [];
  for (const part of covered) {
    if (part.until < since) continue;
    if (part.since > range.until) break;
    if (part.since > since) gaps.push({ since, until: part.since - 1 });
    since = Math.max(since, part.until + 1);
  }
  if (since <= range.until) gaps.push({ since, until: range.until });
  return gaps;
}

function cover(ranges: Range[], range: Range) {
  if (range.since > range.until) return;
  ranges.push(range);
  ranges.sort((a, b) => a.since - b.since);
  for (let i = 1; i < ranges.length;) {
    if (ranges[i].since <= ranges[i - 1].until + 1) {
      ranges[i - 1].until = Math.max(ranges[i - 1].until, ranges[i].until);
      ranges.splice(i, 1);
    } else i++;
  }
}

function loadWindows(
  request: FiltersRequest,
  filters: TimelessFilter[],
  sourceName: string,
  opts?: CommonTimelineLoaderOptions,
  tracker?: Tracker,
): OperatorFunction<TimelineWindow, NostrEvent> {
  const config = options(opts);
  return (source) =>
    defer(() => {
      // Coverage belongs to this subscription, never to a detached loader or another consumer.
      const states: FilterState[] = filters.map((filter) => ({
        filter,
        covered: [],
        boundaries: new Map<number, Set<string>>(),
        blocked: new Set<number>(),
        failures: [],
        ids: new Set<string>(),
        times: [],
      }));
      let visible: Range | undefined;
      // The newest time requested so far; the newer buffer never reaches past it, or every second would need a request.
      let horizon = unixNow();
      let active: ActiveRequest | undefined;
      // Consecutive failed requests, reset by any completed request.
      let failures = 0;
      // When the source started waiting for a response, kept across cancelled requests so a silent source still fails.
      let waiting: number | undefined;
      // The most events this source has returned for one request, a smaller page shows it was not capped.
      let largest = 0;
      const retries$ = new Subject<number>();

      // Buffers a fixed number of events past each visible edge, so the buffer doesn't change with event density.
      const targetFor = (state: FilterState, window: Range): Range => {
        // Load the visible window before anything speculative.
        const part = state.covered.find((p) => p.since <= window.since && p.until >= window.until);
        if (config.prefetch === 0 || !part) return window;
        const { times } = state;
        const n = config.prefetch;

        // NIP-01 returns newest first, so each request below the buffer is an exact page of older events.
        const below = lowerBound(times, window.since);
        const since = below - lowerBound(times, part.since) >= n ? times[below - n] : 0;

        // Relays cannot page forward, so estimate how long the next events take from the density near the edge.
        const above = lowerBound(times, window.until + 1);
        const top = lowerBound(times, part.until + 1);
        let until: number;
        if (top - above >= n) until = times[above + n - 1];
        else if (part.until >= horizon) until = horizon;
        else {
          if (!state.ahead) {
            const from = Math.max(lowerBound(times, part.since), top - n);
            const known = top - from;
            // Without enough events to measure density, buffer one window duration
            const estimate = Math.max(
              60,
              known > 1 ? Math.ceil(((part.until - times[from]) * n) / known) : window.until - window.since,
            );
            state.ahead = { since: part.until, until: part.until + estimate };
          }
          until = Math.min(horizon, Math.max(part.until, state.ahead.until));
        }
        return { since: Math.min(since, window.since), until: Math.max(until, window.until) };
      };

      const target = (window: Range): Range => {
        const ranges = states.map((state) => targetFor(state, window));
        return {
          since: Math.min(...ranges.map((r) => r.since)),
          until: Math.max(...ranges.map((r) => r.until)),
        };
      };

      const report = () => {
        const window = visible;
        if (!window) return;

        for (const state of states) {
          const blocked = [...state.blocked].some((t) => t >= window.since && t <= window.until);
          const failure = state.failures.find(({ range }) => overlaps(range, window));
          const gaps = missing(window, state.covered);
          // The older target is unbounded while pages are still being found, so report how far they reach so far
          const target = targetFor(state, window);
          const part = state.covered.find((p) => p.since <= window.since && p.until >= window.until);
          const status: TimelineStatus = {
            source: sourceName,
            filter: state.filter,
            window: { ...window },
            buffer: { since: target.since === 0 && part ? part.since : target.since, until: target.until },
            state: "covered",
          };

          if (failure) {
            status.state = "incomplete";
            status.reason = "request";
            status.error = failure.error;
          } else if (gaps.length > 0) {
            status.state = "loading";
          } else if (blocked) {
            status.state = "incomplete";
            status.reason = "boundary";
            status.error = new Error("Events at a boundary second cannot be fully paged");
          } else if (active?.prefetch) {
            status.state = "prefetching";
          }

          opts?.onStatus?.(status);
        }
      };

      const pending = (window: Range) =>
        states.flatMap((state) => {
          let gaps = missing(targetFor(state, window), state.covered);

          // Leave failed ranges until their retry time, but keep loading unrelated gaps.
          for (const failure of state.failures) {
            gaps = gaps.flatMap((gap) => missing(gap, [failure.range]));
          }

          return gaps.map((range) => ({ state, range }));
        });

      const loadNext = () =>
        defer(() => {
          if (active || !visible) return of(null);
          const window = visible;

          // Keep adjoining buffer and visible gaps together, prioritizing gaps that intersect the viewport.
          const gaps = pending(window);
          const visibleGaps = gaps.filter(({ range }) => overlaps(range, window));
          const speculative = visibleGaps.length === 0;
          const work = speculative
            ? gaps.filter(({ state }) => missing(window, state.covered).length === 0)
            : visibleGaps;

          // Fill the top of the viewport first. Buffer older events before newer ones, since feeds usually scroll down.
          const sorted = [...work].sort((a, b) => a.range.since - b.range.since);
          const next = speculative
            ? (sorted.filter(({ range }) => range.until < window.since).at(-1) ??
              sorted.find(({ range }) => range.since > window.until))
            : sorted[sorted.length - 1];
          if (!next) {
            report();
            return of(null);
          }

          const { range } = next;
          const pages = work
            .filter((item) => item.range.since === range.since && item.range.until === range.until)
            .map(({ state }) => {
              // NIP-01 returns newest-first. Let older loads fill a whole batch, stopping at known coverage.
              const previous = [...state.covered].reverse().find((part) => part.until < range.since);
              const query = { since: previous ? previous.until + 1 : 0, until: range.until };
              return {
                state,
                query,
                matches: compileFilter({ ...state.filter, ...query }),
                boundary: state.boundaries.get(range.until) ?? new Set<string>(),
                oldest: undefined as number | undefined,
                ids: new Set<string>(),
                fresh: false,
              };
            });

          // A replayed cancellation also covers reentrant window changes from onStatus callbacks.
          const job: ActiveRequest = { range, prefetch: speculative, cancel$: new ReplaySubject<void>(1) };
          active = job;
          report();

          // A source that never answers fails, even when window changes keep cancelling its requests.
          const silentSince = (waiting ??= Date.now());
          let returned = 0;
          return defer(() =>
            request(
              pages.map(({ state, query }) => ({
                ...state.filter,
                ...(query.since === 0 ? { until: query.until } : query),
                limit: config.limit,
              })),
            ),
          ).pipe(
            timeout({ first: new Date(silentSince + config.responseTimeout) }),
            tap({
              next: () => {
                waiting = undefined;
                returned++;
              },
              complete: () => (waiting = undefined),
            }),
            filter((event) => {
              let matches = false;
              for (const page of pages) {
                if (!page.matches(event)) continue;
                matches = true;
                record(page.state, event);
                if (!page.boundary.has(event.id)) page.fresh = true;
                if (page.oldest === undefined || event.created_at < page.oldest) {
                  page.oldest = event.created_at;
                  page.ids.clear();
                }
                if (event.created_at === page.oldest) page.ids.add(event.id);
              }
              return matches;
            }),
            tap({
              complete: () => {
                if (active !== job) return;
                failures = 0;
                const capped = returned >= largest;
                largest = Math.max(largest, returned);
                // Commit only completed pages. Keep the inclusive oldest second for the next request.
                for (const { state, query, oldest, fresh, ids, boundary } of pages) {
                  state.boundaries.delete(range.until);
                  // Nothing new in a page smaller than one this source has already returned means the range is exhausted.
                  if (oldest === undefined || (!fresh && !capped)) cover(state.covered, query);
                  else if (!fresh) {
                    // A relay can cap below our limit; repeated boundary-only pages cannot prove that second complete.
                    state.blocked.add(range.until);
                    cover(state.covered, { since: range.until, until: range.until });
                  } else {
                    cover(state.covered, { since: oldest + 1, until: range.until });
                    if (oldest === range.until) for (const id of boundary) ids.add(id);
                    state.boundaries.set(oldest, ids);
                  }
                }
                tracker?.success();
              },
            }),
            catchError((error) => {
              // Back off a failing source exponentially instead of retrying it on every window change.
              const retryAt = Date.now() + Math.min(config.retryDelay * 2 ** failures++, MAX_RETRY_DELAY);
              waiting = undefined;
              for (const { state } of pages) state.failures.push({ range: { ...range }, error, retryAt });
              opts?.logger?.("Timeline request failed", error);
              retries$.next(retryAt);
              tracker?.failure(error, silentSince);
              return EMPTY;
            }),
            // Keep this after the completion tap: cancellation must not commit coverage.
            takeUntil(job.cancel$),
            finalize(() => {
              if (active === job) active = undefined;
              job.cancel$.complete();
              report();
            }),
          );
        });

      // Drop failures whose backoff has passed so their ranges load again.
      const expire = () => {
        const now = Date.now();
        for (const state of states) state.failures = state.failures.filter((failure) => failure.retryAt > now);
      };

      return source.pipe(
        map(normalize),
        connect((windows) =>
          merge(
            windows.pipe(
              tap({
                next: (window) => {
                  // Re-estimate the newer buffer once half of it has scrolled into view, not on every small change.
                  for (const state of states) {
                    if (state.ahead && window.until > (state.ahead.since + state.ahead.until) / 2)
                      state.ahead = undefined;
                  }
                  visible = window;
                  horizon = Math.max(horizon, window.until);
                  expire();

                  if (visible.since > visible.until) {
                    active?.cancel$.next();
                    report();
                    return;
                  }
                  const current = active;
                  if (current) {
                    const outsideTarget = !overlaps(current.range, target(window));
                    const visibleWorkElsewhere =
                      current.prefetch &&
                      states.some((state) =>
                        missing(window, state.covered).some((gap) => !overlaps(gap, current.range)),
                      );

                    if (outsideTarget || visibleWorkElsewhere) {
                      current.cancel$.next();
                    }
                  }
                  report();
                },
              }),
            ),
            // Wake up when a backoff ends, but only while windows can still arrive.
            retries$.pipe(
              mergeMap((retryAt) => timer(Math.max(0, retryAt - Date.now()))),
              tap(() => {
                expire();
                report();
              }),
              takeUntil(windows.pipe(ignoreElements(), endWith(null))),
            ),
          ),
        ),
        // Coalesce viewport updates, retaining the latest target while a batch is loading.
        auditTime(0, asapScheduler),
        exhaustMap(() =>
          loadNext().pipe(
            // Yield between batches, including synchronous cache responses, and recheck the latest target.
            repeat({ delay: () => timer(0, asapScheduler) }),
            // No pending range ends this drain; exhaustMap then waits for another viewport update.
            takeWhile((event): event is NostrEvent => event !== null),
          ),
        ),
      );
    });
}

/**
 * Loads finite timeline windows from a cache
 * @throws if batch or prefetch options are invalid
 */
export function loadBlocksFromCache(
  request: CacheRequest,
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return loadWindows(
    (filters) => makeCacheRequest(request, filters),
    Array.isArray(filters) ? filters : [filters],
    "cache",
    opts,
  );
}

/**
 * Loads finite timeline windows from one relay
 * @throws if batch or prefetch options are invalid
 */
export function loadBlocksFromRelay(
  pool: UpstreamPool,
  relay: string,
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  const request = wrapUpstreamPool(pool);
  const liveness = opts?.liveness;
  const tracker = liveness && {
    success: () => liveness.recordSuccess(relay),
    failure: (error: unknown, startedAt: number) => {
      if (liveness.recordRequestFailure) liveness.recordRequestFailure(relay, error, startedAt);
      else liveness.recordFailure(relay);
    },
  };
  return loadWindows(
    (filters) => request([relay], filters),
    Array.isArray(filters) ? filters : [filters],
    relay,
    opts,
    tracker,
  );
}

/** Loads finite timeline windows independently from multiple relays */
export function loadBlocksFromRelays(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) =>
    source.pipe(
      connect((windows) =>
        merge(...relays.map((relay) => windows.pipe(loadBlocksFromRelay(pool, relay, filters, opts)))),
      ),
    );
}

/** Loads finite timeline windows while reconciling changing relay filters */
export function loadBlocksFromFilterMap(
  pool: UpstreamPool,
  relayMap: FilterMap | Observable<FilterMap>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return reconcileFilterMap(
    relayMap,
    (relay, filters, settings) => loadBlocksFromRelay(pool, relay, filters, settings),
    opts,
  );
}

function reconcileFilterMap(
  relayMap: FilterMap | Observable<FilterMap>,
  makeLoader: (
    source: string,
    filters: TimelessFilter[] | TimelessFilter,
    opts?: CommonTimelineLoaderOptions,
  ) => OperatorFunction<TimelineWindow, NostrEvent>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) =>
    source.pipe(
      connect(
        (windows) => {
          const maps$ = isObservable(relayMap) ? relayMap : of(relayMap);
          const ended$ = windows.pipe(ignoreElements(), endWith(true), startWith(false));

          // Freeze the map when windows end, waiting for the first map if it arrives late.
          return combineLatest([maps$, ended$]).pipe(
            takeWhile(([, ended]) => !ended, true),
            map(([filters]) => filters),
            scan(
              (previous, current) => {
                const changes: FilterChange[] = [];
                for (const relay of new Set([...Object.keys(previous.filters), ...Object.keys(current)])) {
                  if (
                    previous.filters[relay] &&
                    current[relay] &&
                    isFilterEqual(previous.filters[relay], current[relay])
                  )
                    continue;
                  changes.push({ relay, filters: current[relay] });
                }
                return { filters: current, changes };
              },
              {
                filters: {} as FilterMap,
                changes: [] as FilterChange[],
              },
            ),
            mergeMap(({ changes }) => from(changes)),
            groupBy(({ relay }) => relay),
            mergeMap((relay$) =>
              defer(() => {
                let statuses: TimelineStatus[] = [];
                // Switch only the changed relay; unchanged keys retain their request and coverage.
                return relay$.pipe(
                  switchMap(({ relay, filters }) => {
                    for (const status of statuses) opts?.onStatus?.({ ...status, state: "removed" });
                    statuses = [];
                    if (!filters) return EMPTY;

                    return windows.pipe(
                      makeLoader(relay, filters, {
                        ...opts,
                        onStatus: (status) => {
                          const index = statuses.findIndex((old) => isFilterEqual(old.filter, status.filter));
                          if (index < 0) statuses.push(status);
                          else statuses[index] = status;
                          opts?.onStatus?.(status);
                        },
                      }),
                    );
                  }),
                );
              }),
            ),
          );
        },
        { connector: () => new ReplaySubject<TimelineWindow>(1) },
      ),
    );
}

/** Loads finite timeline windows from each user's outbox relays */
export function loadBlocksFromOutboxMap(
  pool: UpstreamPool,
  outboxes: OutboxMap | Observable<OutboxMap>,
  filter: TimelessFilter | ((users: ProfilePointer[]) => TimelessFilter | TimelessFilter[]),
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  const maps = (isObservable(outboxes) ? outboxes : of(outboxes)).pipe(
    map((outboxes) =>
      typeof filter === "function"
        ? Object.fromEntries(Object.entries(outboxes).map(([relay, users]) => [relay, filter(users)]))
        : createFilterMap(outboxes, filter),
    ),
  );
  return loadBlocksFromFilterMap(pool, maps, opts);
}

/** Loads finite timeline windows for outbox users from a cache */
export function loadBlocksFromOutboxMapCache(
  cache: CacheRequest,
  outboxes: OutboxMap | Observable<OutboxMap>,
  filter: TimelessFilter | ((users: ProfilePointer[]) => TimelessFilter | TimelessFilter[]),
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  const maps = (isObservable(outboxes) ? outboxes : of(outboxes)).pipe(
    map((outboxes): FilterMap => {
      const users = [
        ...new Map(
          Object.values(outboxes)
            .flat()
            .map((user) => [user.pubkey, user]),
        ).values(),
      ];
      if (!users.length) return {};
      return {
        cache:
          typeof filter === "function"
            ? filter(users)
            : mergeFilters(filter, { authors: users.map((user) => user.pubkey) }),
      };
    }),
  );
  return reconcileFilterMap(maps, (_source, filters, settings) => loadBlocksFromCache(cache, filters, settings), opts);
}

function createLoader(
  build: (windows: Observable<TimelineWindow>, opts: TimelineLoaderOptions) => Observable<NostrEvent>,
  opts?: TimelineLoaderOptions,
): TimelineLoader {
  options(opts);
  const status = new BehaviorSubject<TimelineStatus[]>([]);
  const loader = (input: TimelineWindow | Observable<TimelineWindow>) =>
    defer(() => {
      status.next([]);
      const statuses: TimelineStatus[] = [];
      const settings = {
        ...opts,
        onStatus: (next: TimelineStatus) => {
          const index = statuses.findIndex(
            (entry) => entry.source === next.source && isFilterEqual(entry.filter, next.filter),
          );
          if (next.state === "removed") {
            if (index >= 0) statuses.splice(index, 1);
          } else if (index < 0) statuses.push(next);
          else statuses[index] = next;
          status.next([...statuses]);
          opts?.onStatus?.(next);
        },
      };
      if (!isObservable(input)) normalize(input);
      return build(isObservable(input) ? input : of(input), settings).pipe(
        mapEventsToStore(opts?.eventStore ?? new EventMemory<NostrEvent>(), false),
        // Store every arrival before deduplicating output, preserving relay metadata.
        distinct((event) => event.id),
      );
    }).pipe(share());

  return Object.assign(loader, { status$: status.asObservable() });
}

/**
 * Creates a reactive window loader for multiple relays and an optional cache
 * @throws if batch or prefetch options are invalid
 */
export function createTimelineLoader(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: TimelineLoaderOptions,
): TimelineLoader {
  return createLoader(
    (windows, settings) =>
      windows.pipe(
        connect((source) =>
          merge(
            source.pipe(loadBlocksFromRelays(pool, relays, filters, settings)),
            settings.cache ? source.pipe(loadBlocksFromCache(settings.cache, filters, settings)) : EMPTY,
          ),
        ),
      ),
    { logger: baseLogger.extend("timeline"), ...opts },
  );
}

/**
 * Creates a reactive window loader for changing outbox maps and an optional cache
 * @throws if batch or prefetch options are invalid
 */
export function createOutboxTimelineLoader(
  pool: UpstreamPool,
  outboxes: OutboxMap | Observable<OutboxMap>,
  filter: TimelessFilter | ((users: ProfilePointer[]) => TimelessFilter | TimelessFilter[]),
  opts?: TimelineLoaderOptions,
): TimelineLoader {
  return createLoader(
    (windows, settings) =>
      windows.pipe(
        connect((source) =>
          merge(
            source.pipe(loadBlocksFromOutboxMap(pool, outboxes, filter, settings)),
            settings.cache
              ? source.pipe(loadBlocksFromOutboxMapCache(settings.cache, outboxes, filter, settings))
              : EMPTY,
          ),
        ),
      ),
    { logger: baseLogger.extend("outbox-timeline"), ...opts },
  );
}
