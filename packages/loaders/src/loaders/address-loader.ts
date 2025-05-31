import { IEventStore, mapEventsToStore } from "applesauce-core";
import {
  createReplaceableAddress,
  getReplaceableAddress,
  getReplaceableIdentifier,
  isReplaceable,
  mergeRelaySets,
} from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";
import { bufferTime, catchError, EMPTY, filter, isObservable, map, Observable, of, pipe, switchMap, take } from "rxjs";

import {
  consolidateAddressPointers,
  createFiltersFromAddressPointers,
  isLoadableAddressPointer,
  LoadableAddressPointer,
} from "../helpers/address-pointer.js";
import { makeCacheRequest } from "../helpers/cache.js";
import { batchLoader } from "../helpers/loaders.js";
import { wrapGeneratorFunction } from "../operators/generator.js";
import { CacheRequest, NostrRequest } from "../types.js";

/** A method that takes address pointers and returns an observable of events */
export type AddressPointersLoader = (pointers: LoadableAddressPointer[]) => Observable<NostrEvent>;
export type AddressPointerLoader = (pointer: LoadableAddressPointer) => Observable<NostrEvent>;

/**
 * Loads address pointers from an async cache
 * @note ignores pointers with force=true
 */
export function cacheAddressPointersLoader(request: CacheRequest): AddressPointersLoader {
  return (pointers) =>
    makeCacheRequest(
      request,
      createFiltersFromAddressPointers(
        pointers
          // Ignore pointers that want to skip cache
          .filter((p) => p.force !== true),
      ),
    );
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
    // Resolve the relays as an observable
    (isObservable(relays) ? relays : of(relays)).pipe(
      // Only take the first value
      take(1),
      // Make the request
      switchMap((relays) => {
        if (relays.length === 0) return EMPTY;

        const filters = createFiltersFromAddressPointers(pointers);
        return request(relays, filters);
      }),
    );
}

/** Creates a loader that loads all event pointers based on their relays */
export function addressPointerLoadingSequence(
  ...loaders: (AddressPointersLoader | undefined)[]
): AddressPointersLoader {
  return wrapGeneratorFunction<[LoadableAddressPointer[]], NostrEvent>(function* (pointers) {
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
      remaining = remaining.filter(
        (p) => !addresses.has(createReplaceableAddress(p.kind, p.pubkey, p.identifier)) || p.force === true,
      );

      // If there are no remaining pointers, complete
      if (remaining.length === 0) return;
    }
  });
}

export type AddressLoaderOptions = Partial<{
  /** Time interval to buffer requests in ms ( default 1000 ) */
  bufferTime: number;
  /** Max buffer size ( default 200 ) */
  bufferSize: number;
  /** An event store used to deduplicate events */
  eventStore: IEventStore;
  /** A method used to load events from a local cache */
  cacheRequest: CacheRequest;
  /** Whether to follow relay hints ( default true ) */
  followRelayHints: boolean;
  /** Fallback lookup relays to check when event cant be found */
  lookupRelays: string[] | Observable<string[]>;
  /** An array of relays to always fetch from */
  extraRelays: string[] | Observable<string[]>;
}>;

/** Create a pre-built address pointer loader that supports batching, caching, and lookup relays */
export function addressPointerLoader(request: NostrRequest, opts?: AddressLoaderOptions): AddressPointerLoader {
  return batchLoader(
    // Create batching sequence
    pipe(
      // filter out invalid pointers
      filter(isLoadableAddressPointer),
      // buffer requests by time or size
      bufferTime(opts?.bufferTime ?? 1000, undefined, opts?.bufferSize ?? 200),
      // Ingore empty buffers
      filter((b) => b.length > 0),
      // consolidate buffered pointers
      map(consolidateAddressPointers),
    ),
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
    // Pass all events through the store if defined
    opts?.eventStore && mapEventsToStore(opts.eventStore),
  );
}
