import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { Observable } from "rxjs";

/** A flexible method for requesting events from a cache */
export type CacheRequest = (
  filters: Filter[],
) => Observable<NostrEvent> | Promise<NostrEvent | NostrEvent[]> | NostrEvent | NostrEvent[];

/** A flexible type for the upstream relay pool */
export type UpstreamPool = NostrRequest | { request: NostrRequest };

/** A method for requesting events from a relay or cache` */
export type FilterRequest = (filters: Filter[]) => Observable<NostrEvent>;

/** A method for requesting events from multiple relays */
export type NostrRequest = (relays: string[], filters: Filter[]) => Observable<NostrEvent>;

/** A filter that is does not have a since or until */
export type TimelessFilter = Omit<Filter, "since" | "until">;
