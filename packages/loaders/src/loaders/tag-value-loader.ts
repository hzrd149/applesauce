import { EventMemory } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { filterDuplicateEvents } from "applesauce-core/observable";
import {
  bufferTime,
  catchError,
  defer,
  EMPTY,
  identity,
  merge,
  Observable,
  takeUntil,
  timer,
  throwError,
  mergeMap,
  from,
} from "rxjs";
import { unique } from "../helpers/array.js";
import { makeCacheRequest } from "../helpers/cache.js";
import { batchLoader, Loader, unwrap } from "../helpers/loaders.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, NostrRequest, UpstreamPool } from "../types.js";

/** A tag value and relay hints to load */
export type TagValuePointer = {
  /** The value of the tag to load */
  value: string;
  /** The relays to load from */
  relays?: string[];
  /** bypass the cache */
  force?: boolean;
};

/** The source of a failed tag value request */
export type TagValueLoaderErrorSource =
  | { /** The failed cache source */ source: "cache" }
  | { /** The failed relay source */ source: "relay"; /** The relay URL */ relay: string };

/** Options for batching and fetching events by tag value */
export type TagValueLoaderOptions = {
  /** Time interval to buffer requests in ms ( default 1000 ) */
  bufferTime?: number;
  /** Max buffer size ( default 200 ) */
  bufferSize?: number;
  /** Maximum running batches ( default 4 ) */
  maxConcurrentBatches?: number;
  /** Maximum running relay requests per batch ( default 8 ) */
  relayConcurrency?: number;
  /** Maximum cache or relay request lifetime in ms ( default 10000, Infinity disables ) */
  requestTimeout?: number;
  /** Restrict queries to specific kinds */
  kinds?: number[];
  /** Restrict queries to specific authors */
  authors?: string[];
  /** Restrict queries since */
  since?: number;
  /** Method used to load from the cache */
  cacheRequest?: CacheRequest;
  /** A callback for cache and individual relay failures that are skipped while other sources continue */
  onError?: (error: unknown, source: TagValueLoaderErrorSource) => void;
  /** An array of relays to always fetch from */
  extraRelays?: string[] | Observable<string[]>;
  /** An event store used to deduplicate events. Set to null to disable deduplication */
  eventStore?: Parameters<typeof filterDuplicateEvents>[0] | null;
  /** An {@link AbortSignal} that tears down the loader when aborted */
  signal?: AbortSignal;
};

/** A batched loader for events matching a tag value */
export type TagValueLoader = Loader<TagValuePointer, NostrEvent>;

function isolateSource(
  load: () => Observable<NostrEvent>,
  source: TagValueLoaderErrorSource,
  opts?: TagValueLoaderOptions,
): Observable<NostrEvent> {
  const duration = opts?.requestTimeout ?? 10000;
  return defer(load).pipe(
    // A total lifetime deadline, independent of how frequently events arrive.
    takeUntil(
      duration === Infinity
        ? EMPTY
        : timer(duration).pipe(mergeMap(() => throwError(() => new Error("Tag value request timed out")))),
    ),
    catchError((error) => {
      opts?.onError?.(error, source);
      return EMPTY;
    }),
  );
}

/** Creates a loader that gets tag values from the cache */
export function cacheTagValueLoader(
  request: CacheRequest,
  tagName: string,
  opts?: TagValueLoaderOptions,
): (pointers: TagValuePointer[]) => Observable<NostrEvent> {
  return (pointers) => {
    const baseFilter: Filter = {};
    if (opts?.kinds) baseFilter.kinds = opts.kinds;
    if (opts?.authors) baseFilter.authors = opts.authors;
    if (opts?.since !== undefined) baseFilter.since = opts.since;

    const filterTag: `#${string}` = `#${tagName}`;
    const filter = { ...baseFilter, [filterTag]: unique(pointers.map((p) => p.value)) };

    return isolateSource(() => makeCacheRequest(request, [filter]), { source: "cache" }, opts);
  };
}

/** Creates a loader that gets tag values from relays */
export function relaysTagValueLoader(
  request: NostrRequest,
  tagName: string,
  opts?: TagValueLoaderOptions,
): (pointers: TagValuePointer[]) => Observable<NostrEvent> {
  const filterTag: `#${string}` = `#${tagName}`;

  return (pointers) =>
    unwrap(opts?.extraRelays, (extraRelays) => {
      const baseFilter: Filter = {};
      if (opts?.kinds) baseFilter.kinds = opts.kinds;
      if (opts?.authors) baseFilter.authors = opts.authors;
      if (opts?.since !== undefined) baseFilter.since = opts.since;

      // build request map for relays
      const requestMap = pointers.reduce<Record<string, Filter>>((map, pointer) => {
        const relays = mergeRelaySets(pointer.relays, extraRelays);

        for (const relay of relays) {
          if (!map[relay]) {
            // create new filter for relay
            map[relay] = { ...baseFilter, [filterTag]: [pointer.value] };
          } else {
            // map for relay already exists, add the tag value
            map[relay][filterTag]!.push(pointer.value);
          }
        }
        return map;
      }, {});

      const requests = Object.entries(requestMap).map(([relay, filter]) => {
        filter[filterTag] = unique(filter[filterTag]!);
        return isolateSource(() => request([relay], [filter]), { source: "relay", relay }, opts);
      });

      return from(requests).pipe(mergeMap(identity, opts?.relayConcurrency ?? 8));
    });
}

/** Create a pre-built tag value loader that supports batching, caching, and relay hints */
export function createTagValueLoader(
  pool: UpstreamPool,
  tagName: string,
  opts?: TagValueLoaderOptions,
): TagValueLoader {
  const request = wrapUpstreamPool(pool);

  return batchLoader(
    // buffer requests by time or size
    bufferTime(opts?.bufferTime ?? 1000, undefined, opts?.bufferSize ?? 200),
    // Create a loader for batching
    (pointers) => {
      // Skip if there are no pointers
      if (pointers.length === 0) return EMPTY;

      // Load from cache and relays in parallel
      return merge(
        // load from cache if available
        opts?.cacheRequest ? cacheTagValueLoader(opts.cacheRequest, tagName, opts)(pointers) : [],
        // load from relays
        relaysTagValueLoader(request, tagName, opts)(pointers),
      );
    },
    // Filter results based on requests
    (pointer, event) => event.tags.some((tag) => tag[0] === tagName && tag[1] === pointer.value),
    // Pass all events through the store if provided, or use EventMemory for deduplication by default
    opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore || new EventMemory<NostrEvent>()),
    // Forward the abort signal for explicit teardown
    { signal: opts?.signal, maxConcurrentBatches: opts?.maxConcurrentBatches ?? 4 },
  );
}
