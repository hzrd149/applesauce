import { EventMemory } from "applesauce-core/event-store";
import { NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { filterDuplicateEvents } from "applesauce-core/observable";
import { bufferTime, catchError, defer, EMPTY, identity, merge, Observable, tap } from "rxjs";
import { makeCacheRequest } from "../helpers/cache.js";
import { consolidateEventPointers } from "../helpers/event-pointer.js";
import { batchLoader, Loader, loadUntilSettled, unwrap, withStageTimeout } from "../helpers/loaders.js";
import { groupByRelay, groupByUntriedRelays, isPointerCovered } from "../helpers/pointer.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { wrapGeneratorFunction } from "../operators/generator.js";
import { CacheRequest, NostrRequest, UpstreamPool } from "../types.js";

export type LoadableEventPointer = EventPointer & {
  cache?: boolean;
};

export type EventPointerLoader = Loader<LoadableEventPointer, NostrEvent>;
export type createEventLoader = (pointers: LoadableEventPointer[]) => Observable<NostrEvent>;

/** Creates a loader that gets a single event from the cache */
export function cacheEventsLoader(request: CacheRequest): createEventLoader {
  return (pointers) => {
    pointers = pointers.filter((p) => p.cache !== false);

    if (pointers.length === 0) return EMPTY;
    return makeCacheRequest(request, [{ ids: pointers.map((p) => p.id) }]);
  };
}

/**
 * Creates a loader that gets an array of events from a list of relays
 * @param tried Returns the relays an earlier stage already asked for a pointer, so they are skipped
 */
export function relaysEventsLoader(
  request: NostrRequest,
  relays: string[] | Observable<string[]>,
  tried?: (pointer: LoadableEventPointer) => string[] | undefined,
): createEventLoader {
  return (pointers) =>
    unwrap(relays, (relays) =>
      merge(
        ...groupByUntriedRelays(pointers, relays, tried).map(([relays, pointers]) =>
          // Re-request ids a capped relay dropped
          loadUntilSettled(
            pointers,
            (remaining) => request(relays, [{ ids: remaining.map((p) => p.id) }]),
            (p) => p.id,
            (e) => e.id,
          ),
        ),
      ),
    );
}

/** Creates a loader that gets an array of events from a single relay */
export function relayEventsLoader(request: NostrRequest, relay: string): createEventLoader {
  return relaysEventsLoader(request, [relay]);
}

/** Creates a loader that creates a new loader for each relay hint and uses them to load events */
export function relayHintsEventsLoader(
  request: NostrRequest,
  upstream: (request: NostrRequest, relay: string) => createEventLoader = relayEventsLoader,
): createEventLoader {
  const loaders = new Map<string, createEventLoader>();

  // Get or create a new loader for each relay
  const getLoader = (relay: string) => {
    let loader = loaders.get(relay);
    if (!loader) {
      loader = upstream(request, relay);
      loaders.set(relay, loader);
    }

    return loader;
  };

  return (pointers) => {
    // Group pointers by thier relay hints
    const byRelay = groupByRelay(pointers);

    // Request the pointers from each relay
    return merge(
      ...Array.from(byRelay).map(([relay, pointers]) =>
        getLoader(relay)(pointers).pipe(
          // Dont let a failing relay cancel the other hints
          catchError(() => EMPTY),
        ),
      ),
    );
  };
}

/** Creates a loader that tries to load events from a list of loaders in order */
export function eventLoadingSequence(...loaders: (createEventLoader | undefined)[]): createEventLoader {
  return wrapGeneratorFunction<[EventPointer[]], NostrEvent>(function* (pointers) {
    // Filter out invalid pointers and consolidate
    pointers = consolidateEventPointers(pointers);

    // Skip if there are no pointers
    if (pointers.length === 0) return;

    const found = new Set<string>();
    let remaining = Array.from(pointers);

    for (const loader of loaders) {
      if (loader === undefined) continue;

      // Defer so a synchronous throw while building the request is caught like an async error
      yield defer(() => loader(remaining)).pipe(
        // If the loader throws an error, skip it
        catchError(() => EMPTY),
        // Record events that where found
        tap((e) => found.add(e.id)),
      );

      // Remove poniters that where found
      remaining = remaining.filter((p) => !found.has(p.id));

      // If there are no remaining pointers, complete
      if (remaining.length === 0) return;
    }
  });
}

export type EventPointerLoaderOptions = Partial<{
  /** Time interval to buffer requests in ms ( default 200 ) */
  bufferTime: number;
  /** Max buffer size ( default 200 ) */
  bufferSize: number;
  /** An event store loaded events are added to and deduplicated with ( default an internal EventMemory, null disables deduplication ) */
  eventStore?: Parameters<typeof filterDuplicateEvents>[0] | null;
  /** A method used to load events from a local cache */
  cacheRequest: CacheRequest;
  /** Whether to follow relay hints ( default true ) */
  followRelayHints: boolean;
  /** Relays to ask for events the cache and relay hints didn't resolve */
  extraRelays: string[] | Observable<string[]>;
  /** The maximum number of batches requesting relays at once ( default 4 ) */
  maxConcurrentBatches: number;
  /** Time in ms before a loading stage gives up and moves unresolved pointers to the next stage, 0 to disable ( default 10000 ) */
  stageTimeout: number;
  /** An {@link AbortSignal} that tears down the loader when aborted */
  signal: AbortSignal;
}>;

/** Creates a pre-built event pointer loader that supports batching, caching, relay hints, and extra relays */
export function createEventLoader(pool: UpstreamPool, opts?: EventPointerLoaderOptions): EventPointerLoader {
  const request = wrapUpstreamPool(pool);
  const stageTimeout = opts?.stageTimeout ?? 10_000;
  const followHints = opts?.followRelayHints !== false;

  return batchLoader(
    // Create batching sequence
    // buffer requests by time or size
    bufferTime(opts?.bufferTime ?? 200, undefined, opts?.bufferSize ?? 200),
    // Create a loader for batching
    eventLoadingSequence(
      // Step 1. load from cache if available
      withStageTimeout(opts?.cacheRequest ? cacheEventsLoader(opts.cacheRequest) : undefined, stageTimeout),
      // Step 2. load from relay hints on pointers
      withStageTimeout(opts?.followRelayHints !== false ? relayHintsEventsLoader(request) : undefined, stageTimeout),
      // Step 3. load from extra relays
      withStageTimeout(
        opts?.extraRelays
          ? relaysEventsLoader(request, opts.extraRelays, followHints ? (p) => p.relays : undefined)
          : undefined,
        stageTimeout,
      ),
    ),
    // Filter resutls based on requests
    (pointer, event) => event.id === pointer.id,
    // Pass all events through the store if provided, or use EventMemory for deduplication by default
    opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore || new EventMemory<NostrEvent>()),
    {
      // Forward the abort signal for explicit teardown
      signal: opts?.signal,
      // Bound how many batches request relays at once
      maxConcurrentBatches: opts?.maxConcurrentBatches ?? 4,
      // Repeated pointers join the batch already loading them
      inflight: { key: (p) => p.id, covers: isPointerCovered },
    },
  );
}
