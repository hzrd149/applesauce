import { logger as baseLogger, mapEventsToStore } from "applesauce-core";
import {
  createFilterMap,
  FilterMap,
  isFilterEqual,
  mergeFilters,
  OutboxMap,
  ProfilePointer,
} from "applesauce-core/helpers";
import { nanoid } from "nanoid";
import { Filter, NostrEvent } from "nostr-tools";
import {
  BehaviorSubject,
  distinctUntilChanged,
  EMPTY,
  finalize,
  identity,
  isObservable,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  OperatorFunction,
  share,
  switchMap,
  tap,
} from "rxjs";

import { makeCacheRequest } from "../helpers/cache.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, TimelessFilter, UpstreamPool } from "../types.js";

/** A loader that optionally takes a timestamp to load till and returns a stream of events */
export type TimelineLoader = (since?: number) => Observable<NostrEvent>;

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
  logger?: debug.Debugger;
}>;

/**
 * Watches for changes in the window and loads blocks of events going backward
 * NOTE: this operator is stateful
 */
export function loadBackwardBlocks(
  request: (until?: number) => Observable<NostrEvent>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    const log = opts?.logger?.extend("backward").extend(nanoid(8));
    log?.("Created");

    let cursor: number | undefined = undefined;
    let loading = false;
    let complete = false;

    return source.pipe(
      // NOTE: use mergeMap here to ensure old requests continue to load
      mergeMap(({ since, until }) => {
        // Once complete, prevent further requests
        if (complete) return EMPTY;

        // If max is unset, initialize to until
        if (cursor === undefined && until !== undefined && Number.isFinite(until)) cursor = until;

        // Skip loads if since is still in range
        if (
          // Ignore undefined since values
          since === undefined ||
          // If number is finite and in the loaded range, skip
          (Number.isFinite(since) && cursor !== undefined && since <= cursor)
        )
          return EMPTY;

        // Don't load blocks in parallel
        if (loading) return EMPTY;

        // Set loading lock
        loading = true;

        // Count returned events so complete set
        let count = 0;

        log?.(`Loading block since:${cursor}`);

        // Request the next block of events
        return request(cursor).pipe(
          tap((event) => {
            count++;
            // Update the min created_at seen from the source
            cursor = Math.min(event.created_at, cursor ?? Infinity);
          }),
          finalize(() => {
            loading = false;
            complete = count === 0;

            log?.(`Found ${count} events`);
            if (complete) log?.("Complete");
          }),
        );
      }),
    );
  };
}

/**
 * Watches for changes in the window and loads blocks of events going forward
 * NOTE: this operator is stateful
 */
export function loadForwardBlocks(
  request: (since?: number) => Observable<NostrEvent>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    const log = opts?.logger?.extend("forward").extend(nanoid(8));
    log?.("Created");

    let cursor: number | undefined = undefined;
    let loading = false;
    let complete = false;

    return source.pipe(
      // NOTE: use mergeMap here to ensure old requests continue to load
      mergeMap(({ since, until }) => {
        // Once complete, prevent further requests
        if (complete) return EMPTY;

        // If min is unset, initialize to since
        if (cursor === undefined && since !== undefined && Number.isFinite(since)) cursor = since;

        // Skip loads if until is still in range
        if (
          // Ignore undefined until values
          until === undefined ||
          // If number is finite and in the loaded range, skip
          (Number.isFinite(until) && cursor !== undefined && until <= cursor)
        )
          return EMPTY;

        // Don't load blocks in parallel
        if (loading) return EMPTY;

        // Set loading lock
        loading = true;

        // Count returned events so complete set
        let count = 0;

        log?.(`Loading block until:${cursor}`);

        // Request the next block of events
        return request(cursor).pipe(
          tap((event) => {
            count++;
            // Update the max created_at seen from the source
            cursor = Math.max(event.created_at, cursor ?? -Infinity);
          }),
          finalize(() => {
            loading = false;
            complete = count === 0;

            log?.(`Found ${count} events`);
            if (complete) log?.("Complete");
          }),
        );
      }),
    );
  };
}

/** A loader that loads blocks of events until none are returned or the since timestamp is reached */
export function loadBlocksForTimelineWindow(
  request: (base: Filter) => Observable<NostrEvent>,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) =>
    merge(
      source.pipe(loadBackwardBlocks((until) => request({ until }), opts)),
      source.pipe(loadForwardBlocks((since) => request({ since }), opts)),
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
  const loader = (base: Filter) =>
    makeCacheRequest(
      request,
      // Create filters from filters, base, and optional limit
      filters.map((f) => (opts?.limit ? mergeFilters(f, base, { limit: opts.limit }) : mergeFilters(f, base))),
    );

  return (source) => source.pipe(loadBlocksForTimelineWindow(loader, { ...opts, logger }));
}

/** Loads timeline blocs from relays using a pool or request method */
export function loadBlocksFromRelays(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  if (!Array.isArray(filters)) filters = [filters];

  const logger = opts?.logger?.extend("relays");
  const request = wrapUpstreamPool(pool);
  const loader = (base: Filter) =>
    request(
      relays,
      // Create filters from filters, base, and optional limit
      filters.map((f) => (opts?.limit ? mergeFilters(f, base, { limit: opts.limit }) : mergeFilters(f, base))),
    );

  return (source) => source.pipe(loadBlocksForTimelineWindow(loader, { ...opts, logger }));
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
  const loader = (base: Filter) =>
    request(
      [relay],
      // Create filters from filters, base, and optional limit
      filters.map((f) => (opts?.limit ? mergeFilters(f, base, { limit: opts.limit }) : mergeFilters(f, base))),
    );

  return (source) => source.pipe(loadBlocksForTimelineWindow(loader, { ...opts, logger }));
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

    const loaders$ = map$.pipe(
      map((relayMap) =>
        Object.entries(relayMap).map(([relay, filters]) => {
          const existing = cache.get(relay);
          if (existing && isFilterEqual(existing.filters, filters)) return existing.loader;

          // Create a new loader for this relay + filter set
          const loader = source.pipe(loadBlocksFromRelay(pool, relay, filters, opts));
          cache.set(relay, { filters, loader });
          return loader;
        }),
      ),
    );

    return loaders$.pipe(switchMap((loaders) => merge(...loaders)));
  };
}

export type TimelineLoaderOptions = Partial<{
  /** A method used to load the timeline from the cache */
  cache: CacheRequest;
  /** An event store to pass all the events to */
  eventStore?: Parameters<typeof mapEventsToStore>[0];
}> &
  CommonTimelineLoaderOptions;

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
  return (source) =>
    filters$.pipe(
      // Every time the filters change, create a new cache loader instance
      switchMap((filters) => source.pipe(loadBlocksFromCache(cache, filters, opts))),
    );
}

/** Internal logic for function based timeline loaders */
function wrapTimelineLoader(
  window$: BehaviorSubject<TimelineWindow>,
  loader$: Observable<NostrEvent>,
  eventStore?: Parameters<typeof mapEventsToStore>[0],
): TimelineLoader {
  const singleton$ = loader$.pipe(
    // Pass all events through the store if provided
    eventStore ? mapEventsToStore(eventStore) : identity,
    // Ensure a single subscription to the requests
    share(),
  );

  return (since?: number) => {
    // Return the loader so it can be subscribed to
    return new Observable((observer) => {
      const sub = singleton$.subscribe(observer);

      // Only update window when this request is subscribed to (prevents window getting lost before subscription)
      window$.next({
        // Default to -Infinity to force loading the next block of events (legacy behavior)
        since: since ?? -Infinity,
      });

      return () => sub.unsubscribe();
    });
  };
}

/** @deprecated Use the {@link loadBlocksFromCache} operator instead */
export function cacheTimelineLoader(
  request: CacheRequest,
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  const window$ = new BehaviorSubject<TimelineWindow>({});
  return wrapTimelineLoader(window$, window$.pipe(loadBlocksFromCache(request, filters, opts)));
}

/** @deprecated Use the {@link loadBlocksFromRelays} operator instead */
export function relaysTimelineLoader(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  const window$ = new BehaviorSubject<TimelineWindow>({});
  return wrapTimelineLoader(window$, window$.pipe(loadBlocksFromRelays(pool, relays, filters, opts)));
}

/** Converts an ObservableTimelineLoader to the legacy TimelineLoader format for backwards compatibility */
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

  return wrapTimelineLoader(window$, loader$);
}

/**
 * Creates a timeline loader that loads events for a {@link OutboxMap} or an observable of {@link OutboxMap}
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
  return wrapTimelineLoader(window$, loader$);
}
