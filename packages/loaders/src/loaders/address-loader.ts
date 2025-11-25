import { EventMemory, filterDuplicateEvents } from "applesauce-core";
import {
  createReplaceableAddress,
  getReplaceableAddress,
  getReplaceableIdentifier,
  isReplaceable,
  mergeRelaySets,
} from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { bufferTime, catchError, EMPTY, identity, Observable } from "rxjs";

import { createFiltersFromAddressPointers, isLoadableAddressPointer } from "../helpers/address-pointer.js";
import { makeCacheRequest } from "../helpers/cache.js";
import { batchLoader, unwrap } from "../helpers/loaders.js";
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
export type AddressPointerLoader = (pointer: LoadableAddressPointer) => Observable<NostrEvent>;

/**
 * Loads address pointers from an async cache
 * @note ignores pointers with force=true
 */
export function cacheAddressPointersLoader(request: CacheRequest): AddressPointersLoader {
  return (pointers) => {
    pointers = pointers.filter((p) => p.cache !== false);

    // Skip if there are no pointers to load from cache
    if (pointers.length === 0) return EMPTY;

    return makeCacheRequest(request, createFiltersFromAddressPointers(pointers));
  };
}

/** Loads address pointers from the relay hints */
export function relayHintsAddressPointersLoader(request: NostrRequest): AddressPointersLoader {
  return (pointers) => {
    const relays = mergeRelaySets(...pointers.map((p) => p.relays));
    if (relays.length === 0) return EMPTY;

    const filters = createFiltersFromAddressPointers(pointers);
    return request(relays, filters);
  };
}

/** Loads address pointers from an array of relays */
export function relaysAddressPointersLoader(
  request: NostrRequest,
  relays: Observable<string[]> | string[],
): AddressPointersLoader {
  return (pointers) =>
    unwrap(relays, (relays) => {
      if (relays.length === 0) return EMPTY;

      const filters = createFiltersFromAddressPointers(pointers);
      return request(relays, filters);
    });
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

      const results = yield loader(remaining).pipe(
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
  /** Time interval to buffer requests in ms ( default 1000 ) */
  bufferTime: number;
  /** Max buffer size ( default 200 ) */
  bufferSize: number;
  /** An event store used to deduplicate events. Set to null to disable deduplication */
  eventStore?: Parameters<typeof filterDuplicateEvents>[0] | null;
  /** A method used to load events from a local cache */
  cacheRequest: CacheRequest;
  /** Whether to follow relay hints ( default true ) */
  followRelayHints: boolean;
  /** An array of relays to always fetch from */
  extraRelays: string[] | Observable<string[]>;
  /** Fallback lookup relays to check when event cant be found */
  lookupRelays: string[] | Observable<string[]>;
}>;

/** Create a pre-built address pointer loader that supports batching, caching, and lookup relays */
export function createAddressLoader(pool: UpstreamPool, opts?: AddressLoaderOptions): AddressPointerLoader {
  const request = wrapUpstreamPool(pool);

  return batchLoader(
    // buffer requests by time or size
    bufferTime(opts?.bufferTime ?? 1000, undefined, opts?.bufferSize ?? 200),
    // Create a loader for batching
    addressPointerLoadingSequence(
      // Step 1. load from cache if available
      opts?.cacheRequest ? cacheAddressPointersLoader(opts.cacheRequest) : undefined,
      // Step 2. load from relay hints on pointers
      opts?.followRelayHints !== false ? relayHintsAddressPointersLoader(request) : undefined,
      // Step 3. load from extra relays
      opts?.extraRelays ? relaysAddressPointersLoader(request, opts.extraRelays) : undefined,
      // Step 4. load from lookup relays
      opts?.lookupRelays ? relaysAddressPointersLoader(request, opts.lookupRelays) : undefined,
    ),
    // Filter resutls based on requests
    (pointer, event) =>
      event.kind === pointer.kind &&
      event.pubkey === pointer.pubkey &&
      (pointer.identifier ? getReplaceableIdentifier(event) === pointer.identifier : true),
    // Pass all events through the store if provided, or use EventMemory for deduplication by default
    opts?.eventStore === null ? identity : filterDuplicateEvents(opts?.eventStore || new EventMemory()),
  );
}
