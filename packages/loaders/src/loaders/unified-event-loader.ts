import { filterDuplicateEvents, IMissingEventLoader } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { isEventPointer } from "applesauce-core/helpers/pointers";
import { Loader } from "../helpers/loaders.js";
import { UpstreamPool } from "../types.js";
import { AddressLoaderOptions, createAddressLoader, LoadableAddressPointer } from "./address-loader.js";
import { createEventLoader, EventPointerLoaderOptions, LoadableEventPointer } from "./event-loader.js";

export type UnifiedEventLoaderOptions = Partial<EventPointerLoaderOptions & AddressLoaderOptions>;

export type UnifiedEventLoader = Loader<LoadableEventPointer | LoadableAddressPointer, NostrEvent>;

/**
 * Create a unified event loader that can handle both EventPointer and AddressPointer types.
 * Internally routes to createEventLoader for EventPointer and createAddressLoader for AddressPointer.
 */
export function createUnifiedEventLoader(pool: UpstreamPool, opts?: UnifiedEventLoaderOptions): UnifiedEventLoader {
  // Create both loaders with the appropriate options
  const eventLoader = createEventLoader(pool, {
    bufferTime: opts?.bufferTime,
    bufferSize: opts?.bufferSize,
    eventStore: opts?.eventStore,
    cacheRequest: opts?.cacheRequest,
    followRelayHints: opts?.followRelayHints,
    extraRelays: opts?.extraRelays,
    signal: opts?.signal,
  });

  const addressLoader = createAddressLoader(pool, {
    bufferTime: opts?.bufferTime,
    bufferSize: opts?.bufferSize,
    eventStore: opts?.eventStore,
    cacheRequest: opts?.cacheRequest,
    followRelayHints: opts?.followRelayHints,
    extraRelays: opts?.extraRelays,
    lookupRelays: opts?.lookupRelays,
    signal: opts?.signal,
  });

  // Return a unified loader that routes based on pointer type
  const loader = (pointer: LoadableEventPointer | LoadableAddressPointer) => {
    // Check if it's an EventPointer (has 'id' property)
    if (isEventPointer(pointer)) {
      return eventLoader(pointer);
    } else {
      return addressLoader(pointer);
    }
  };

  // Tearing down the unified loader tears down both underlying loaders
  const stop = () => {
    eventLoader.stop();
    addressLoader.stop();
  };

  return Object.assign(loader, { stop, [Symbol.dispose]: stop });
}

/**
 * Creates a {@link UnifiedEventLoader} that will be used to load events that are not found in the store
 * @returns The created loader
 */
export function createEventLoaderForStore(
  store: IMissingEventLoader & Parameters<typeof filterDuplicateEvents>[0],
  pool: UpstreamPool,
  opts?: Omit<UnifiedEventLoaderOptions, "eventStore">,
) {
  const loader = createUnifiedEventLoader(pool, { ...opts, eventStore: store });
  store.eventLoader = loader;
  return loader;
}
