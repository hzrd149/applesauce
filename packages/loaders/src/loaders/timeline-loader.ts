import { mapEventsToStore } from "applesauce-core";
import { NostrEvent } from "nostr-tools";
import { EMPTY, finalize, identity, merge, Observable, tap } from "rxjs";

import { makeCacheRequest } from "../helpers/cache.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, FilterRequest, NostrRequest, TimelessFilter, UpstreamPool } from "../types.js";

/** A loader that optionally takes a timestamp to load till and returns a stream of events */
export type TimelineLoader = (since?: number) => Observable<NostrEvent>;

/** Common options for timeline loaders */
export type CommonTimelineLoaderOptions = Partial<{
  limit: number;
}>;

/** A loader that loads blocks of events until none are returned or the since timestamp is reached */
export function filterBlockLoader(
  request: FilterRequest,
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  let cursor = Infinity;
  let complete = false;

  return (since) => {
    if (complete) return EMPTY;
    if (since !== undefined && cursor <= since) return EMPTY;

    // Keep loading blocks until none are returned or an event is found that is ealier then the new cursor
    const withTime = filters.map((filter) => ({
      ...filter,
      limit: filter.limit || opts?.limit,
      until: cursor !== Infinity ? cursor : undefined,
    }));

    let count = 0;

    // Load the next block of events
    return request(withTime).pipe(
      tap((event) => {
        // Update the cursor to the oldest event
        cursor = Math.min(event.created_at - 1, cursor);
        count++;
      }),
      finalize(() => {
        // Set the loader to complete if no events are returned
        if (count === 0) complete = true;
      }),
    );
  };
}

/** Creates a loader that loads a timeline from a cache */
export function cacheTimelineLoader(
  request: CacheRequest,
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  return filterBlockLoader((filters) => makeCacheRequest(request, filters), filters, opts);
}

/** Creates a timeline loader that loads the same filters from multiple relays */
export function relaysTimelineLoader(
  request: NostrRequest,
  relays: string[],
  filters: TimelessFilter[],
  opts?: CommonTimelineLoaderOptions,
): TimelineLoader {
  const loaders = relays.map((relay) => filterBlockLoader((f) => request([relay], f), filters, opts));
  return (since?: number) => merge(...loaders.map((l) => l(since)));
}

export type TimelineLoaderOptions = Partial<{
  /** A method used to load the timeline from the cache */
  cache: CacheRequest;
  /** An event store to pass all the events to */
  eventStore?: Parameters<typeof mapEventsToStore>[0];
}> &
  CommonTimelineLoaderOptions;

/** A common timeline loader that takes an array of relays and a cache method */
export function createTimelineLoader(
  pool: UpstreamPool,
  relays: string[],
  filters: TimelessFilter[] | TimelessFilter,
  opts?: TimelineLoaderOptions,
): TimelineLoader {
  if (!Array.isArray(filters)) filters = [filters];

  const request = wrapUpstreamPool(pool);

  const cacheLoader = opts?.cache && cacheTimelineLoader(opts.cache, filters, opts);
  const relayLoader = relaysTimelineLoader(request, relays, filters, opts);

  return (since?: number) =>
    merge(cacheLoader?.(since) ?? EMPTY, relayLoader?.(since)).pipe(
      opts?.eventStore ? mapEventsToStore(opts.eventStore) : identity,
    );
}
