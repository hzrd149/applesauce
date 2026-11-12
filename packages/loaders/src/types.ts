import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { Observable } from "rxjs";

/** A signal that allows relay loading to start before the cache stream completes */
export type CacheRelease = {
  /** The optional release signal */
  type: "release";
};

/** An event or an optional signal releasing relay loading */
export type CacheEmission = NostrEvent | CacheRelease;

/** A cache request that blocks relay loading until it completes or emits a release signal */
export type CacheRequest = (
  filters: Filter[],
) => Observable<CacheEmission> | Promise<NostrEvent | NostrEvent[]> | NostrEvent | NostrEvent[];

/** A method for requesting events from multiple relays */
export type NostrRequest = (relays: string[], filters: Filter[]) => Observable<NostrEvent>;

/** A flexible type for the upstream relay pool */
export type UpstreamPool = NostrRequest | { request: NostrRequest };

/** A filter that is does not have a since or until */
export type TimelessFilter = Omit<Filter, "since" | "until">;
