import { EventMemory, filterDuplicateEvents } from "applesauce-core";
import {
  createReplaceableAddress,
  getReplaceableAddress,
  getReplaceableIdentifier,
  isReplaceable,
  mergeRelaySets,
} from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { bufferTime, catchError, defer, EMPTY, identity, merge, Observable } from "rxjs";

import { createFiltersFromAddressPointers, isLoadableAddressPointer } from "../helpers/address-pointer.js";
import { makeCacheRequest } from "../helpers/cache.js";
import { batchLoader, Loader, loadUntilSettled, unwrap, withStageTimeout } from "../helpers/loaders.js";
import { groupByRelay, groupByUntriedRelays, isPointerCovered } from "../helpers/pointer.js";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { wrapGeneratorFunction } from "../operators/generator.js";
import { CacheRequest, NostrRequest, UpstreamPool } from "../types.js";

export type LoadableAddressPointer = {
  kind: number;
  pubkey: string;
  /** Optional "d" tag for paramaritized replaceable */
  identifier?: string;
  /** Relays to load from */
  relays?: string[];
  /** Whether to ignore the cache */
  cache?: boolean;
};

/** A method that takes address pointers and returns an observable of events */
export type AddressPointersLoader = (pointers: LoadableAddressPointer[]) => Observable<NostrEvent>;
export type AddressPointerLoader = Loader<LoadableAddressPointer, NostrEvent>;

/**
 * Loads address pointers from an async cache
 * @note ignores pointers with `cache: false`
 */
export function cacheAddressPointersLoader(request: CacheRequest): AddressPointersLoader {
  return (pointers) => {
    pointers = pointers.filter((p) => p.cache !== false);

    // Skip if there are no pointers to load from cache
    if (pointers.length === 0) return EMPTY;

    return makeCacheRequest(request, createFiltersFromAddressPointers(pointers));
  };
}

/** Requests address pointers from relays and re-requests the addresses a capped relay dropped */
function requestAddressPointers(
  request: NostrRequest,
  relays: string[],
  pointers: LoadableAddressPointer[],
): Observable<NostrEvent> {
  return loadUntilSettled(
    pointers,
    (remaining) => request(relays, createFiltersFromAddressPointers(remaining)),
    (p) => createReplaceableAddress(p.kind, p.pubkey, p.identifier),
    (e) => (isReplaceable(e.kind) ? (getReplaceableAddress(e) ?? undefined) : undefined),
  );
}

/** Loads address pointers from the relay hints */
export function relayHintsAddressPointersLoader(request: NostrRequest): AddressPointersLoader {
  return (pointers) => {
    // Group pointers by their relay hints so each relay is only asked for its own pointers
    const byRelay = groupByRelay(pointers);

    return merge(
      ...Array.from(byRelay).map(([relay, pointers]) =>
        requestAddressPointers(request, [relay], pointers).pipe(
          // Dont let a failing relay cancel the other hints
          catchError(() => EMPTY),
        ),
      ),
    );
  };
}

/**
 * Loads address pointers from an array of relays
 * @param tried Returns the relays an earlier stage already asked for a pointer, so they are skipped
 */
export function relaysAddressPointersLoader(
  request: NostrRequest,
  relays: Observable<string[]> | string[],
  tried?: (pointer: LoadableAddressPointer) => string[] | undefined,
): AddressPointersLoader {
  return (pointers) =>
    unwrap(relays, (relays) =>
      merge(
        ...groupByUntriedRelays(pointers, relays, tried).map(([relays, pointers]) =>
          requestAddressPointers(request, relays, pointers),
        ),
      ),
    );
}

/** Creates a loader that loads all event pointers based on their relays */
export function addressPointerLoadingSequence(
  ...loaders: (AddressPointersLoader | undefined)[]
): AddressPointersLoader {
  return wrapGeneratorFunction<[LoadableAddressPointer[]], NostrEvent>(function* (pointers) {
    // Filter out invalid pointers and consolidate
    pointers = consolidateAddressPointers(pointers.filter(isLoadableAddressPointer));

    // Skip if there are no pointers
    if (pointers.length === 0) return;

    // Keep track of remaining pointers to load
    let remaining = Array.from(pointers);

    for (const loader of loaders) {
      if (loader === undefined) continue;

      // Defer so a synchronous throw while building the request is caught like an async error
      const results = yield defer(() => loader(remaining)).pipe(
        // If the loader throws an error, skip it
        catchError(() => EMPTY),
      );

      // Get set of addresses loaded
      const addresses = new Set(
        results.filter((e) => isReplaceable(e.kind)).map((event) => getReplaceableAddress(event)),
      );

      // Remove the pointers that were loaded
      remaining = remaining.filter((p) => !addresses.has(createReplaceableAddress(p.kind, p.pubkey, p.identifier)));

      // If there are no remaining pointers, complete
      if (remaining.length === 0) return;
    }
  });
}

/** deep clone a loadable pointer to ensure its safe to modify */
function cloneLoadablePointer(pointer: LoadableAddressPointer): LoadableAddressPointer {
  const clone = { ...pointer };
  if (pointer.relays) clone.relays = [...pointer.relays];
  return clone;
}

/** deduplicates an array of address pointers and merges their relays array */
export function consolidateAddressPointers(pointers: LoadableAddressPointer[]): LoadableAddressPointer[] {
  const byAddress = new Map<string, LoadableAddressPointer>();

  for (const pointer of pointers) {
    const addr = createReplaceableAddress(pointer.kind, pointer.pubkey, pointer.identifier);
    if (byAddress.has(addr)) {
      // duplicate, merge pointers
      const current = byAddress.get(addr)!;

      // merge relays
      if (pointer.relays && pointer.relays.length > 0) {
        if (current.relays) current.relays = mergeRelaySets(current.relays, pointer.relays);
        else current.relays = pointer.relays;
      }

      // merge cache flag
      if (pointer.cache === false) current.cache = false;
    } else byAddress.set(addr, cloneLoadablePointer(pointer));
  }

  // return consolidated pointers
  return Array.from(byAddress.values());
}

export type AddressLoaderOptions = Partial<{
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
  /** Relays to ask for pointers the cache and relay hints didn't resolve */
  extraRelays: string[] | Observable<string[]>;
  /** Fallback relays to ask for pointers still unresolved after the extra relays */
  lookupRelays: string[] | Observable<string[]>;
  /** The maximum number of batches requesting relays at once ( default 4 ) */
  maxConcurrentBatches: number;
  /** Time in ms before a loading stage gives up and moves unresolved pointers to the next stage, 0 to disable ( default 10000 ) */
  stageTimeout: number;
  /** An {@link AbortSignal} that tears down the loader when aborted */
  signal: AbortSignal;
}>;

/** Create a pre-built address pointer loader that supports batching, caching, and lookup relays */
export function createAddressLoader(pool: UpstreamPool, opts?: AddressLoaderOptions): AddressPointerLoader {
  const request = wrapUpstreamPool(pool);
  const stageTimeout = opts?.stageTimeout ?? 10_000;
  const followHints = opts?.followRelayHints !== false;

  return batchLoader(
    // buffer requests by time or size
    bufferTime(opts?.bufferTime ?? 200, undefined, opts?.bufferSize ?? 200),
    // Create a loader for batching
    addressPointerLoadingSequence(
      // Step 1. load from cache if available
      withStageTimeout(opts?.cacheRequest ? cacheAddressPointersLoader(opts.cacheRequest) : undefined, stageTimeout),
      // Step 2. load from relay hints on pointers
      withStageTimeout(
        opts?.followRelayHints !== false ? relayHintsAddressPointersLoader(request) : undefined,
        stageTimeout,
      ),
      // Step 3. load from extra relays
      withStageTimeout(
        opts?.extraRelays
          ? relaysAddressPointersLoader(request, opts.extraRelays, followHints ? (p) => p.relays : undefined)
          : undefined,
        stageTimeout,
      ),
      // Step 4. load from lookup relays, skipping the hints and extra relays already asked
      withStageTimeout(
        opts?.lookupRelays
          ? (pointers) =>
              unwrap(opts.extraRelays ?? [], (extras) =>
                relaysAddressPointersLoader(request, opts.lookupRelays!, (p) =>
                  followHints && p.relays ? [...p.relays, ...extras] : extras,
                )(pointers),
              )
          : undefined,
        stageTimeout,
      ),
    ),
    // Filter resutls based on requests
    (pointer, event) =>
      event.kind === pointer.kind &&
      event.pubkey === pointer.pubkey &&
      (pointer.identifier !== undefined ? getReplaceableIdentifier(event) === pointer.identifier : true),
    // Pass all events through the store if provided, or use EventMemory for deduplication by default
    opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore || new EventMemory<NostrEvent>()),
    {
      // Forward the abort signal for explicit teardown
      signal: opts?.signal,
      // Bound how many batches request relays at once
      maxConcurrentBatches: opts?.maxConcurrentBatches ?? 4,
      // Repeated pointers join the batch already loading them
      inflight: { key: (p) => createReplaceableAddress(p.kind, p.pubkey, p.identifier), covers: isPointerCovered },
    },
  );
}
