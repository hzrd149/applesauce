import { getReplaceableAddress, isReplaceable, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getSeenRelays, mergeRelaySets } from "applesauce-core/helpers/relays";
import { Observable } from "rxjs";
import { wrapUpstreamPool } from "../helpers/upstream.js";
import { UpstreamPool } from "../types.js";
import { createTagValueLoader, TagValueLoaderOptions } from "./tag-value-loader.js";

/** A loader that takes an event and returns zaps */
export type ReactionsLoader = (event: NostrEvent, relays?: string[]) => Observable<NostrEvent>;

export type ReactionsLoaderOptions = Omit<TagValueLoaderOptions, "kinds"> & {
  /** Whether to request reactions from the relays the event was seen on ( default true ) */
  useSeenRelays?: boolean;
};

/** Creates a loader that loads reaction events for a given event */
export function createReactionsLoader(pool: UpstreamPool, opts?: ReactionsLoaderOptions): ReactionsLoader {
  const request = wrapUpstreamPool(pool);

  const eventLoader = createTagValueLoader(request, "e", { ...opts, kinds: [kinds.Reaction] });
  const addressableLoader = createTagValueLoader(request, "a", { ...opts, kinds: [kinds.Reaction] });

  // Return diffrent loaders depending on if the event is addressable
  return (event, relays) => {
    if (opts?.useSeenRelays ?? true) relays = mergeRelaySets(relays, getSeenRelays(event));

    return isReplaceable(event.kind)
      ? addressableLoader({ value: getReplaceableAddress(event), relays })
      : eventLoader({ value: event.id, relays });
  };
}
