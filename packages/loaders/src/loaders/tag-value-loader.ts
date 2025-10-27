import { EventMemory, filterDuplicateEvents } from "applesauce-core";
import { mergeRelaySets } from "applesauce-core/helpers";
import { Filter, NostrEvent } from "nostr-tools";
import { bufferTime, EMPTY, identity, merge, Observable } from "rxjs";

import { unique } from "../helpers/array.js";
import { makeCacheRequest } from "../helpers/cache.js";
import { batchLoader, unwrap } from "../helpers/loaders.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { CacheRequest, NostrRequest, UpstreamPool } from "../types.js";

export type TagValuePointer = {
  /** The value of the tag to load */
  value: string;
  /** The relays to load from */
  relays?: string[];
  /** bypass the cache */
  force?: boolean;
};

export type TagValueLoaderOptions = {
  /** Time interval to buffer requests in ms ( default 1000 ) */
  bufferTime?: number;
  /** Max buffer size ( default 200 ) */
  bufferSize?: number;
  /** Restrict queries to specific kinds */
  kinds?: number[];
  /** Restrict queries to specific authors */
  authors?: string[];
  /** Restrict queries since */
  since?: number;
  /** Method used to load from the cache */
  cacheRequest?: CacheRequest;
  /** An array of relays to always fetch from */
  extraRelays?: string[] | Observable<string[]>;
  /** An event store used to deduplicate events. Set to null to disable deduplication */
  eventStore?: Parameters<typeof filterDuplicateEvents>[0] | null;
};

export type TagValueLoader = (pointer: TagValuePointer) => Observable<NostrEvent>;

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
    if (opts?.since) baseFilter.since = opts.since;

    const filterTag: `#${string}` = `#${tagName}`;
    const filter = { ...baseFilter, [filterTag]: unique(pointers.map((p) => p.value)) };

    return makeCacheRequest(request, [filter]);
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
      if (opts?.since) baseFilter.since = opts.since;

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

      const requests = Object.entries(requestMap).map(([relay, filter]) => request([relay], [filter]));

      return merge(...requests);
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
    opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore || new EventMemory()),
  );
}
