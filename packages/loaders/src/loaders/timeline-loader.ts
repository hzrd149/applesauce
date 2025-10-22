import { mapEventsToStore } from "applesauce-core";
import { NostrEvent } from "nostr-tools";
import {
  BehaviorSubject,
  EMPTY,
  finalize,
  identity,
  merge,
  Observable,
  OperatorFunction,
  share,
  switchMap,
  tap,
} from "rxjs";

import { unixNow } from "applesauce-core/helpers";
import { makeCacheRequest } from "../helpers/cache.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, FilterRequest, TimelessFilter, UpstreamPool } from "../types.js";

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
}>;

/** Watches for changes in the window and loads blocks of events going backward */
export function loadBackwardBlocks(
  request: FilterRequest,
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    let max: number | undefined = undefined;
    let loading = false;

    return source.pipe(
      switchMap(({ since, until }) => {
        // If max is unset, initialize to until
        if (max === undefined && until !== undefined && Number.isFinite(until)) max = until;

        // Skip loads if since is still in range
        if (
          // Ignore undefined since values
          since === undefined ||
          // If number is finite and in the loaded range, skip
          (Number.isFinite(since) && max !== undefined && since <= max)
        )
          return EMPTY;

        // Don't load blocks in parallel
        if (loading) return EMPTY;

        // Set loading lock
        loading = true;

        // Request the next block of events
        return request(
          filters.map((filter) => ({
            ...filter,
            limit: filter.limit || opts?.limit,
            until: max,
          })),
        ).pipe(
          tap((event) => {
            // Update the max created_at seen from the source
            max = Math.min(event.created_at, max ?? Infinity);
          }),
          finalize(() => {
            loading = false;
          }),
        );
      }),
      // Ensure only single subscription to the request
      share(),
    );
  };
}

/** Watches for changes in the window and loads blocks of events going forward */
export function loadForwardBlocks(
  request: FilterRequest,
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    let min: number | undefined = undefined;
    let loading = false;

    return source.pipe(
      switchMap(({ since, until }) => {
        // If min is unset, initialize to since
        if (min === undefined && since !== undefined && Number.isFinite(since)) min = since;

        // Skip loads if until is still in range
        if (
          // Ignore undefined until values
          until === undefined ||
          // If number is finite and in the loaded range, skip
          (Number.isFinite(until) && min !== undefined && until <= min)
        )
          return EMPTY;

        // Don't load blocks in parallel
        if (loading) return EMPTY;

        // Set loading lock
        loading = true;

        // Request the next block of events
        return request(
          filters.map((filter) => ({
            ...filter,
            limit: filter.limit || opts?.limit,
            since: min,
          })),
        ).pipe(
          tap((event) => {
            // Update the min created_at seen from the source
            min = Math.min(event.created_at, min ?? -Infinity);
          }),
          finalize(() => {
            loading = false;
          }),
        );
      }),
      // Ensure only single subscription to the request
      share(),
    );
  };
}

/** A loader that loads blocks of events until none are returned or the since timestamp is reached */
export function loadBlocksForWindow(
  request: FilterRequest,
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) =>
    merge(
      // Load backward blocks
      source.pipe(loadBackwardBlocks(request, filters, opts)),
      // Load forward blocks
      source.pipe(loadForwardBlocks(request, filters, opts)),
    ).pipe(
      // Ensure only single subscription to the requests
      share(),
    );
}

/** Loads timeline blocs from cache using a cache request */
export function loadBlocksFromCache(
  request: CacheRequest,
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => source.pipe(loadBlocksForWindow((filters) => makeCacheRequest(request, filters), filters, opts));
}

/** Loads timeline blocs from relays using a pool or request method */
export function loadBlocksFromRelays(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  return (source) => {
    const request = wrapUpstreamPool(pool);
    return source.pipe(
      // Create block loader with adapter for relay request
      loadBlocksForWindow((filters) => request(relays, filters), filters, opts),
    );
  };
}

export type TimelineLoaderOptions = Partial<{
  /** A method used to load the timeline from the cache */
  cache: CacheRequest;
  /** An event store to pass all the events to */
  eventStore?: Parameters<typeof mapEventsToStore>[0];
}> &
  CommonTimelineLoaderOptions;

/** Takes a stream of {@link TimelineWindow} and loads events from the cache and relays */
export function loadEventsForTimelineWindow(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: TimelineLoaderOptions,
): OperatorFunction<TimelineWindow, NostrEvent> {
  if (!Array.isArray(filters)) filters = [filters];

  return (source) => {
    const cacheLoader = opts?.cache && source.pipe(loadBlocksFromCache(opts.cache, filters, opts));
    const relayLoader = source.pipe(loadBlocksFromRelays(pool, relays, filters, opts));

    return merge(
      // Cache loader should run independently of the relay loader
      cacheLoader ?? EMPTY,
      // Load from relays
      relayLoader,
    ).pipe(
      // Pass all events through the store if provided
      opts?.eventStore ? mapEventsToStore(opts.eventStore) : identity,
      // Ensure a single subscription to the requests
      share(),
    );
  };
}

/** Create a timeline loader for a stream of {@link TimelineWindow} */
export function createWindowTimelineLoader(
  window$: Observable<TimelineWindow>,
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: TimelineLoaderOptions,
): Observable<NostrEvent> {
  return window$.pipe(loadEventsForTimelineWindow(pool, relays, filters, opts));
}

/** Internal logic for function based timeline loaders */
function internalCreateTimelineLoader(operator: OperatorFunction<TimelineWindow, NostrEvent>): TimelineLoader {
  const window$ = new BehaviorSubject<TimelineWindow>({});
  const loader$ = window$.pipe(operator);
  let complete = false;

  return (since?: number) => {
    // Once complete, prevent further requests (legacy behavior)
    if (complete) return EMPTY;

    // Return the loader so it can be subscribed to
    return new Observable((observer) => {
      let count = 0;
      const sub = loader$
        .pipe(
          tap(() => count++),
          finalize(() => (complete = count === 0)),
        )
        .subscribe(observer);

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
  if (!Array.isArray(filters)) filters = [filters];
  return internalCreateTimelineLoader(loadBlocksFromCache(request, filters, opts));
}

/** @deprecated Use the {@link loadBlocksFromRelays} operator instead */
export function relaysTimelineLoader(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  if (!Array.isArray(filters)) filters = [filters];
  return internalCreateTimelineLoader(loadBlocksFromRelays(pool, relays, filters, opts));
}

/** Converts an ObservableTimelineLoader to the legacy TimelineLoader format for backwards compatibility */
export function createTimelineLoader(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: TimelineLoaderOptions,
): TimelineLoader {
  return internalCreateTimelineLoader(loadEventsForTimelineWindow(pool, relays, filters, opts));
}
