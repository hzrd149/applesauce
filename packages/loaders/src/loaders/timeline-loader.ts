import { logger as baseLogger, type Debugger } from "applesauce-core";
import { EventMemory } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { unixNow } from "applesauce-core/helpers/time";
import { Filter, isFilterEqual, matchFilter, mergeFilters } from "applesauce-core/helpers/filter";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { createFilterMap, FilterMap, OutboxMap } from "applesauce-core/helpers/relay-selection";
import { filterDuplicateEvents, mapEventsToStore } from "applesauce-core/observable";
import { nanoid } from "nanoid";
import {
  BehaviorSubject,
  catchError,
  concat,
  connect,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  identity,
  ignoreElements,
  isObservable,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  OperatorFunction,
  share,
  Subject,
  Subscription,
  switchMap,
  takeUntil,
  tap,
} from "rxjs";
import { makeCacheRequest } from "../helpers/cache.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, TimelessFilter, UpstreamPool } from "../types.js";

/** A loader that optionally takes a timestamp to load till and returns a stream of events */
export type TimelineLoader = (since?: number | TimelineWindow) => Observable<NostrEvent>;

/**
 * The current `since` value of the timeline loader
 * `undefined` is used to initialize the loader to "now"
 * -Infinity (for since) and Infinity (for until) should be used to force loading the next block of events
 */
export type TimelineWindow = { since?: number; until?: number };

/** Common options for timeline loaders */
export type CommonTimelineLoaderOptions = Partial<{
  limit: number;

  /** Logger to extend */
  logger?: Debugger;
}>;

const TIMELINE_CALL = Symbol("timeline-call");

/** Tracks the blocks a single loader call is waiting on, so the call can complete when they settle */
class TimelineCall {
  private pending = 0;
  settled = false;
  readonly done$ = new Subject<void>();

  join() {
    if (!this.settled) this.pending++;
  }
  leave() {
    if (this.settled) return;
    this.pending--;
    this.check();
  }
  /** Settles on a microtask so a block re-joined in the same tick (like a resubscribed relay) keeps the call open */
  check() {
    if (this.pending > 0) return;
    queueMicrotask(() => {
      if (this.pending > 0 || this.settled) return;
      this.settled = true;
      this.done$.next();
      this.done$.complete();
    });
  }
}

/** Gets the loader call that emitted a window */
function getTimelineCall(window: TimelineWindow): TimelineCall | undefined {
  return (window as { [TIMELINE_CALL]?: TimelineCall })[TIMELINE_CALL];
}

/** Collects the loader calls waiting on the current block of an operator */
function createBlockCalls() {
  let calls = new Set<TimelineCall>();

  return {
    join(window: TimelineWindow) {
      const call = getTimelineCall(window);
      if (!call || calls.has(call)) return;
      calls.add(call);
      call.join();
    },
    /** Releases the calls waiting on the current block */
    release() {
      const released = calls;
      calls = new Set();
      for (const call of released) call.leave();
    },
  };
}

/** Holds loader calls open until `ready$` emits, so calls made before the relays are known don't complete empty */
function holdCallsUntilReady<T>(
  source: Observable<TimelineWindow>,
  ready$: Observable<T>,
): [Observable<never>, Observable<T>] {
  let ready = false;
  const held = createBlockCalls();
  const release$ = new Subject<void>();

  // Stop watching windows once ready so the hold doesn't keep the operator from completing
  const hold$ = defer(() => (ready ? EMPTY : source.pipe(takeUntil(release$), tap(held.join), ignoreElements())));
  const released$ = ready$.pipe(
    // Released calls settle on a microtask, after the new sources have subscribed and joined the replayed window
    tap(() => {
      if (ready) return;
      ready = true;
      release$.next();
      held.release();
    }),
  );

  return [hold$, released$];
}

/** The next inclusive `until` of a paged request and the ids already loaded at that second */
type PageCursor = { until: number; boundary: Set<string> };

/** Tracks the events of one page requested newest-first and picks the cursor for the next page */
function createPage(since: number | undefined, until: number | undefined, boundary: Set<string>) {
  let count = 0;
  let fresh = 0;
  let oldest: number | undefined;
  let oldestIds = new Set<string>();

  return {
    get count() {
      return count;
    },
    get fresh() {
      return fresh;
    },
    add(event: NostrEvent) {
      // Ignore events from relays that do not respect the bounds
      if (until !== undefined && event.created_at > until) return;
      if (since !== undefined && event.created_at < since) return;

      count++;
      if (!boundary.has(event.id)) fresh++;

      if (oldest === undefined || event.created_at < oldest) {
        oldest = event.created_at;
        oldestIds = new Set([event.id]);
      } else if (event.created_at === oldest) oldestIds.add(event.id);
    },
    /** Returns the cursor for the next page, or undefined when the range has nothing older */
    next(): PageCursor | undefined {
      // Only an empty page proves there is nothing older
      if (count === 0 || oldest === undefined) return undefined;

      let cursor: PageCursor;
      if (fresh === 0 && until !== undefined) {
        // Every event was already loaded, so more events share the cursor second than the relay returns
        // in one page. They can't be paged by time, so step past the second
        cursor = { until: until - 1, boundary: new Set() };
      } else {
        // NIP-01 defines `until` as inclusive. Request the oldest second again so events cut off at the
        // end of this page are not skipped
        if (oldest === until) for (const id of boundary) oldestIds.add(id);
        cursor = { until: oldest, boundary: oldestIds };
      }

      return since !== undefined && cursor.until < since ? undefined : cursor;
    },
  };
}

/** A method that requests one block of events for a list of filters */
type FiltersRequest = (filters: Filter[]) => Observable<NostrEvent>;

/** Adds the bounds and limit of a block to a filter, keeping every other field */
function withBounds(filter: Filter, since?: number, until?: number, limit?: number): Filter {
  const result: Filter = { ...filter };
  if (since !== undefined) result.since = since;
  if (until !== undefined) result.until = until;
  if (limit) result.limit = limit;
  return result;
}

/** Adds an event to the page of every filter it matches. A lone filter takes every event the relay returns */
function addToPages(event: NostrEvent, filters: Filter[], pages: ReturnType<typeof createPage>[]) {
  if (filters.length === 1) return pages[0].add(event);
  for (let i = 0; i < filters.length; i++) if (matchFilter(filters[i], event)) pages[i].add(event);
}

/**
 * Loads blocks of events going backward with a separate cursor for each filter, since NIP-01 applies `limit` to
 * each filter and a sparse filter would otherwise move the cursor past a dense one
 */
function loadBackwardFilterBlocks(
  filters: Filter[],
  request: FiltersRequest,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    const log = opts?.logger?.extend("backward").extend(nanoid(8));

    // The next inclusive `until` for each filter, plus the ids already loaded at that second
    const cursors = filters.map((filter) => ({
      filter,
      until: undefined as number | undefined,
      boundary: new Set<string>(),
      complete: false,
    }));
    let loading = false;
    const calls = createBlockCalls();

    // Filters that still have events to load above `since`. The cursor is the next inclusive `until`,
    // so everything newer than the cursor has already been loaded
    const pending = (since: number) =>
      cursors.filter(
        (cursor) =>
          !cursor.complete && (cursor.until === undefined || !Number.isFinite(since) || since <= cursor.until),
      );

    return source.pipe(
      filter((window) => {
        const { since, until } = window;

        // Ignore windows replayed from calls that already finished
        if (getTimelineCall(window)?.settled) return false;

        // If the cursor is unset, initialize to until
        if (until !== undefined && Number.isFinite(until))
          for (const cursor of cursors) if (cursor.until === undefined) cursor.until = until;

        // Skip loads if since is unset or still in range
        if (since === undefined || pending(since).length === 0) return false;

        // Don't load blocks in parallel, wait for the current block instead
        calls.join(window);
        if (loading) return false;

        return true;
      }),
      // NOTE: use mergeMap here to ensure old requests continue to load
      mergeMap(({ since }) => {
        // Set loading lock
        loading = true;

        const active = pending(since!);
        const pages = active.map((cursor) => createPage(undefined, cursor.until, cursor.boundary));

        log?.(`Loading block until:${active.map((cursor) => cursor.until).join(",")}`);

        // Request the next block of events
        return request(active.map((cursor) => withBounds(cursor.filter, undefined, cursor.until, opts?.limit))).pipe(
          tap((event) =>
            addToPages(
              event,
              active.map((cursor) => cursor.filter),
              pages,
            ),
          ),
          // Only commit the cursors when the block finishes, a cancelled block proves nothing about the source
          tap({
            complete: () => {
              active.forEach((cursor, i) => {
                const page = pages[i];
                log?.(`Found ${page.count} events (${page.fresh} new)`);

                const next = page.next();
                if (!next) cursor.complete = true;
                else {
                  if (page.fresh === 0) log?.(`Skipping saturated second ${cursor.until}`);
                  cursor.until = next.until;
                  cursor.boundary = next.boundary;
                }
              });

              if (cursors.every((cursor) => cursor.complete)) log?.("Complete");
            },
          }),
          // A failed block leaves the cursors where they were so the next window retries it
          catchError((error) => {
            log?.("Failed to load block", error);
            return EMPTY;
          }),
          finalize(() => {
            loading = false;
            calls.release();
          }),
        );
      }),
    );
  };
}

/** Loads the events between the newest loaded time and the window `until`, paging each filter separately */
function loadForwardFilterBlocks(
  filters: Filter[],
  request: FiltersRequest,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    const log = opts?.logger?.extend("forward").extend(nanoid(8));

    // Everything up to the edge has been loaded, it starts where the backward loading starts
    let edge: number | undefined = undefined;
    let loading = false;
    const calls = createBlockCalls();

    return source.pipe(
      filter((window) => {
        const { until } = window;

        // Ignore windows replayed from calls that already finished
        if (getTimelineCall(window)?.settled) return false;

        if (edge === undefined) {
          // Wait for a real window, the empty window seeded by the loaders would start the timeline at now
          if (window.since === undefined && until === undefined) return false;
          edge = until !== undefined && Number.isFinite(until) ? until : unixNow();
        }

        // Skip until the window extends past the edge
        if (until === undefined || until <= edge) return false;

        // Don't load blocks in parallel, wait for the current block instead
        calls.join(window);
        if (loading) return false;

        return true;
      }),
      // NOTE: use mergeMap here to ensure old requests continue to load
      mergeMap(({ until }) => {
        // Set loading lock
        loading = true;

        const since = edge!;
        const target = Math.min(until!, unixNow());

        // Relays return the newest events first, so page backward through the gap until every filter has drained it
        const loadPage = (active: { filter: Filter; cursor: PageCursor }[]): Observable<NostrEvent> => {
          const pages = active.map(({ cursor }) => createPage(since, cursor.until, cursor.boundary));

          log?.(`Loading block since:${since} until:${active.map(({ cursor }) => cursor.until).join(",")}`);

          return concat(
            request(active.map(({ filter, cursor }) => withBounds(filter, since, cursor.until, opts?.limit))).pipe(
              tap((event) =>
                addToPages(
                  event,
                  active.map(({ filter }) => filter),
                  pages,
                ),
              ),
            ),
            defer(() => {
              const next = active.flatMap(({ filter }, i) => {
                const cursor = pages[i].next();
                return cursor ? [{ filter, cursor }] : [];
              });

              return next.length > 0 ? loadPage(next) : EMPTY;
            }),
          );
        };

        return loadPage(
          filters.map((filter) => ({ filter, cursor: { until: target, boundary: new Set<string>() } })),
        ).pipe(
          // Only move the edge once the whole gap has loaded, a cancelled block proves nothing about the source
          tap({
            complete: () => {
              edge = target;
              log?.(`Loaded up to ${target}`);
            },
          }),
          // A failed gap leaves the edge where it was so the next window retries it
          catchError((error) => {
            log?.("Failed to load block", error);
            return EMPTY;
          }),
          finalize(() => {
            loading = false;
            calls.release();
          }),
        );
      }),
    );
  };
}

/** Loads blocks of events going backward and forward with a separate cursor for each filter */
function loadBlocksForFilters(
  filters: Filter[],
  request: FiltersRequest,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) =>
    merge(
      source.pipe(loadBackwardFilterBlocks(filters, request, opts)),
      source.pipe(loadForwardFilterBlocks(filters, request, opts)),
    );
}

/**
 * Watches for changes in the window and loads blocks of events going backward
 * NOTE: this operator is stateful
 */
export function loadBackwardBlocks(
  request: (until?: number) => Observable<NostrEvent>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return loadBackwardFilterBlocks([{}], (filters) => request(filters[0].until), { logger: opts?.logger });
}

/**
 * Watches for changes in the window and loads the events between the newest loaded time and the window `until`
 * NOTE: this operator is stateful
 */
export function loadForwardBlocks(
  request: (since?: number, until?: number) => Observable<NostrEvent>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return loadForwardFilterBlocks([{}], (filters) => request(filters[0].since, filters[0].until), {
    logger: opts?.logger,
  });
}

/** A loader that loads blocks of events until none are returned or the since timestamp is reached */
export function loadBlocksForTimelineWindow(
  request: (base: Filter) => Observable<NostrEvent>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) =>
    merge(
      source.pipe(loadBackwardBlocks((until) => request({ until }), opts)),
      source.pipe(loadForwardBlocks((since, until) => request({ since, until }), opts)),
    );
}

/** Loads timeline blocs from cache using a cache request */
export function loadBlocksFromCache(
  request: CacheRequest,
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  if (!Array.isArray(filters)) filters = [filters];

  const logger = opts?.logger?.extend("cache");
  return loadBlocksForFilters(filters, (filters) => makeCacheRequest(request, filters), { ...opts, logger });
}

/** Loads timeline blocs from relays using a pool or request method */
export function loadBlocksFromRelays(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    // Create the relay loaders once so their cursors survive resubscribing, reading windows from the current connection
    let windows$: Observable<TimelineWindow> = EMPTY;
    const proxy$ = defer(() => windows$);
    const loaders = relays.map((relay) => proxy$.pipe(loadBlocksFromRelay(pool, relay, filters, opts)));

    return source.pipe(
      // Connect after every relay is listening so cold sources deliver each window to all relays.
      connect((windows) => {
        windows$ = windows;
        return merge(...loaders);
      }),
    );
  };
}

/** Loads timeline blocs from relay set using a pool or request method */
export function loadBlocksFromRelay(
  pool: UpstreamPool,
  relay: string,
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  if (!Array.isArray(filters)) filters = [filters];

  const logger = opts?.logger?.extend(relay);
  const request = wrapUpstreamPool(pool);
  return loadBlocksForFilters(filters, (filters) => request([relay], filters), { ...opts, logger });
}

/** Loads timeline blocks from a map of relays and filters */
export function loadBlocksFromFilterMap(
  pool: UpstreamPool,
  relayMap: FilterMap | Observable<FilterMap>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    const map$ = isObservable(relayMap) ? relayMap : of(relayMap);
    const cache = new Map<string, { filters: TimelessFilter[] | TimelessFilter; loader: Observable<NostrEvent> }>();

    const [hold$, ready$] = holdCallsUntilReady(source, map$);

    // Gets the cached loader for a relay, or creates one when the relay is new or its filters changed
    const getLoader = (relay: string, filters: TimelessFilter[] | TimelessFilter) => {
      const existing = cache.get(relay);
      if (existing && isFilterEqual(existing.filters, filters)) return existing.loader;

      const loader = source.pipe(
        loadBlocksFromRelay(pool, relay, filters, opts),
        // Drop a failed relay so it does not terminate the loaders for the other relays
        catchError((error) => {
          opts?.logger?.(`Failed to load blocks from ${relay}`, error);
          return EMPTY;
        }),
      );
      cache.set(relay, { filters, loader });
      return loader;
    };

    // Reconcile relays on each map so unchanged relays keep their in-flight requests
    const relays$ = new Observable<NostrEvent>((observer) => {
      const active = new Map<string, { loader: Observable<NostrEvent>; sub: Subscription }>();
      let mapComplete = false;
      const checkComplete = () => {
        if (mapComplete && active.size === 0) observer.complete();
      };

      const mapSub = ready$.subscribe({
        next: (relayMap) => {
          const loaders = new Map(
            Object.entries(relayMap).map(([relay, filters]) => [relay, getLoader(relay, filters)]),
          );

          // Stop relays that were removed or whose filters changed
          for (const [relay, entry] of active) {
            if (loaders.get(relay) === entry.loader) continue;
            active.delete(relay);
            entry.sub.unsubscribe();
          }

          // Start relays that are new or changed. Subscribe synchronously so they join the replayed window
          for (const [relay, loader] of loaders) {
            if (active.has(relay)) continue;

            const entry = { loader, sub: new Subscription() };
            active.set(relay, entry);
            entry.sub.add(
              loader.subscribe({
                next: (event) => observer.next(event),
                error: (error) => observer.error(error),
                complete: () => {
                  if (active.get(relay) === entry) active.delete(relay);
                  checkComplete();
                },
              }),
            );
          }
        },
        error: (error) => observer.error(error),
        complete: () => {
          mapComplete = true;
          checkComplete();
        },
      });

      return () => {
        mapSub.unsubscribe();
        for (const entry of active.values()) entry.sub.unsubscribe();
        active.clear();
      };
    });

    return merge(hold$, relays$);
  };
}

/** Loads timeline blocks from an {@link OutboxMap} and {@link Filter} or a function that projects users to a filter */
export function loadBlocksFromOutboxMap(
  pool: UpstreamPool,
  outboxes: OutboxMap | Observable<OutboxMap>,
  filter: TimelessFilter | ((users: ProfilePointer[]) => TimelessFilter | TimelessFilter[]),
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  const outboxes$ = isObservable(outboxes) ? outboxes : of(outboxes);

  // Project outbox map to filter map
  const filterMap$ = outboxes$.pipe(
    map<OutboxMap, FilterMap>((outboxes) => {
      // Filter is a dynamic method that returns a filter
      if (typeof filter === "function")
        return Object.fromEntries(Object.entries(outboxes).map(([relay, users]) => [relay, filter(users)]));

      // Filter is just a filter
      return createFilterMap(outboxes, filter);
    }),
  );

  // Load blocks from the filter map
  return loadBlocksFromFilterMap(pool, filterMap$, opts);
}

/** Loads timeline blocks from a {@link CacheRequest} using a {@link OutboxMap} and filters */
export function loadBlocksFromOutboxMapCache(
  cache: CacheRequest,
  outboxes: OutboxMap | Observable<OutboxMap>,
  filter: TimelessFilter | ((users: ProfilePointer[]) => TimelessFilter | TimelessFilter[]),
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  const outboxes$ = isObservable(outboxes) ? outboxes : of(outboxes);

  // Project outboxes to filters
  const filters$ = outboxes$.pipe(
    map((outboxes) => {
      // Get all pubkeys from all relays
      const pubkeys = new Set<string>();
      for (const users of Object.values(outboxes)) {
        for (const user of users) {
          pubkeys.add(user.pubkey);
        }
      }

      // Create filters for all the pubkeys
      if (typeof filter === "function") {
        const users = Array.from(pubkeys).map((pubkey) => ({ pubkey }));
        return filter(users);
      } else {
        return mergeFilters(filter, { authors: Array.from(pubkeys) });
      }
    }),
    // Only create a new loader if the filters change
    distinctUntilChanged((a, b) => isFilterEqual(a, b)),
  );

  // Load blocks from the filter map
  return (source) => {
    const [hold$, ready$] = holdCallsUntilReady(source, filters$);

    return merge(
      hold$,
      ready$.pipe(
        // Every time the filters change, create a new cache loader instance
        switchMap((filters) => source.pipe(loadBlocksFromCache(cache, filters, opts))),
      ),
    );
  };
}

/** Internal logic for function based timeline loaders */
function wrapTimelineLoader(
  window$: BehaviorSubject<TimelineWindow>,
  loader$: Observable<NostrEvent>,
  eventStore?: Parameters<typeof filterDuplicateEvents>[0] | null,
): TimelineLoader {
  // Remember emitted ids across calls, since each call resubscribes and blocks overlap at the boundary second
  const seen = new Set<string>();

  const singleton$ = loader$.pipe(
    // Pass all events through the store if provided
    eventStore === null
      ? identity
      : (source: Observable<NostrEvent>) =>
          source.pipe(
            mapEventsToStore(eventStore || new EventMemory<NostrEvent>(), false),
            filter((event) => !seen.has(event.id) && !!seen.add(event.id)),
          ),
    // Ensure a single subscription to the requests
    share(),
  );

  return (since?: number | TimelineWindow) => {
    // Return the loader so it can be subscribed to
    return new Observable<NostrEvent>((observer) => {
      const call = new TimelineCall();

      // Complete once every block this call started or joined has settled
      const sub = singleton$.pipe(takeUntil(call.done$)).subscribe(observer);

      // Only update window when this request is subscribed to (prevents window getting lost before subscription)
      const window: TimelineWindow =
        typeof since === "object" && since !== undefined
          ? { ...since }
          : // Default to -Infinity to force loading the next block of events (legacy behavior)
            { since: since ?? -Infinity };
      Object.defineProperty(window, TIMELINE_CALL, { value: call });
      window$.next(window);

      // Complete right away if no source started or joined a block
      call.check();

      return () => sub.unsubscribe();
    });
  };
}

/** Options for the create timeline loader methods */
export type TimelineLoaderOptions = Partial<{
  /** A method used to load the timeline from the cache */
  cache: CacheRequest;
  /** An event store to pass all the events to */
  eventStore?: Parameters<typeof mapEventsToStore>[0];
}> &
  CommonTimelineLoaderOptions;

/** @deprecated Use the {@link loadBlocksFromCache} operator instead */
export function cacheTimelineLoader(
  request: CacheRequest,
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  const window$ = new BehaviorSubject<TimelineWindow>({});
  return wrapTimelineLoader(window$, window$.pipe(loadBlocksFromCache(request, filters, opts)));
}

/** @deprecated Use the {@link createTimelineLoader} operator instead */
export function relaysTimelineLoader(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  const window$ = new BehaviorSubject<TimelineWindow>({});
  return wrapTimelineLoader(window$, window$.pipe(loadBlocksFromRelays(pool, relays, filters, opts)));
}

/**
 * Creates a {@link TimelineLoader} that loads events from multiple relays and a cache
 * @param pool - The upstream pool to use
 * @param relays - The relays to load from
 * @param filters - The filters to use
 * @param opts - The options for the timeline loader
 */
export function createTimelineLoader(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: TimelineLoaderOptions,
): TimelineLoader {
  const logger = (opts?.logger ?? baseLogger).extend("timeline").extend(nanoid(4));
  const window$ = new BehaviorSubject<TimelineWindow>({});

  // Create cache and relays loaders
  const cache$ = opts?.cache ? window$.pipe(loadBlocksFromCache(opts.cache, filters, { ...opts, logger })) : EMPTY;

  // Load blocks from relays
  const relays$ = window$.pipe(loadBlocksFromRelays(pool, relays, filters, { ...opts, logger }));

  // Merge the cache and relays loaders
  const loader$ = merge(cache$, relays$);

  return wrapTimelineLoader(window$, loader$, opts?.eventStore);
}

/**
 * Creates a {@link TimelineLoader} that loads events for a {@link OutboxMap} or an observable of {@link OutboxMap}
 * @param pool - The upstream pool to use
 * @param outboxMap - An {@link OutboxMap} or an observable of {@link OutboxMap}
 * @param filter - A function to create filters for a set of users
 * @param opts - The options for the timeline loader
 */
export function createOutboxTimelineLoader(
  pool: UpstreamPool,
  outboxes: OutboxMap | Observable<OutboxMap>,
  filter: TimelessFilter | ((users: ProfilePointer[]) => TimelessFilter | TimelessFilter[]),
  opts?: TimelineLoaderOptions,
): TimelineLoader {
  const logger = (opts?.logger ?? baseLogger).extend("outbox-timeline").extend(nanoid(4));
  const window$ = new BehaviorSubject<TimelineWindow>({});

  // An observable of a cache loader instance for all users
  const cache$ = opts?.cache
    ? window$.pipe(loadBlocksFromOutboxMapCache(opts?.cache, outboxes, filter, { ...opts, logger }))
    : EMPTY;

  // Load blocks from relays using outboxes
  const relays$ = window$.pipe(loadBlocksFromOutboxMap(pool, outboxes, filter, { ...opts, logger }));

  // Merge the cache and relays loaders
  const loader$ = merge(cache$, relays$);

  // Wrap the loader in a timeline loader function
  return wrapTimelineLoader(window$, loader$, opts?.eventStore);
}
