import { getReplaceableAddress, isReplaceable, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getSeenRelays, mergeRelaySets } from "applesauce-core/helpers/relays";
import { EMPTY, Observable } from "rxjs";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { UpstreamPool } from "../types.js";
import { createTagValueLoader, TagValueLoaderOptions } from "./tag-value-loader.js";

/** A loader that takes an event and returns zaps */
export type ZapsLoader = (event: NostrEvent, relays?: string[]) => Observable<NostrEvent>;

export type ZapsLoaderOptions = Omit<TagValueLoaderOptions, "kinds"> & {
  /** Whether to request zaps from the relays the event was seen on ( default true ) */
  useSeenRelays?: boolean;
};

/** Creates a loader that loads zap events for a given event */
export function createZapsLoader(pool: UpstreamPool, opts?: ZapsLoaderOptions): ZapsLoader {
  const request = wrapUpstreamPool(pool);

  const eventLoader = createTagValueLoader(request, "e", { ...opts, kinds: [kinds.Zap] });
  const addressableLoader = createTagValueLoader(request, "a", { ...opts, kinds: [kinds.Zap] });

  // Return diffrent loaders depending on if the event is addressable
  return (event, relays) => {
    if (opts?.useSeenRelays ?? true) relays = mergeRelaySets(relays, getSeenRelays(event));

    if (isReplaceable(event.kind)) {
      const address = getReplaceableAddress(event);
      if (!address) return EMPTY;
      return addressableLoader({ value: address, relays });
    } else {
      return eventLoader({ value: event.id, relays });
    }
  };
}
