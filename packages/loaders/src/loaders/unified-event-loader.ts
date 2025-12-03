import { filterDuplicateEvents, IMissingEventLoader } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, AddressPointerWithoutD, EventPointer, isEventPointer } from "applesauce-core/helpers/pointers";
import { Observable } from "rxjs";
import { UpstreamPool } from "../types.js";
import { AddressLoaderOptions, createAddressLoader } from "./address-loader.js";
import { createEventLoader, EventPointerLoaderOptions } from "./event-loader.js";

export type UnifiedEventLoaderOptions = Partial<EventPointerLoaderOptions & AddressLoaderOptions>;

export type UnifiedEventLoader = (
  pointer: EventPointer | AddressPointer | AddressPointerWithoutD,
) => Observable<NostrEvent>;

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
  });

  const addressLoader = createAddressLoader(pool, {
    bufferTime: opts?.bufferTime,
    bufferSize: opts?.bufferSize,
    eventStore: opts?.eventStore,
    cacheRequest: opts?.cacheRequest,
    followRelayHints: opts?.followRelayHints,
    extraRelays: opts?.extraRelays,
    lookupRelays: opts?.lookupRelays,
  });

  // Return a unified loader that routes based on pointer type
  return (pointer: EventPointer | AddressPointer | AddressPointerWithoutD) => {
    // Check if it's an EventPointer (has 'id' property)
    if (isEventPointer(pointer)) {
      return eventLoader(pointer);
    } else {
      return addressLoader(pointer);
    }
  };
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
