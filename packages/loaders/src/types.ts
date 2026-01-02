import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { Observable } from "rxjs";

/** A flexible method for requesting events from a cache */
export type CacheRequest = (
  filters: Filter[],
) => Observable<NostrEvent> | Promise<NostrEvent | NostrEvent[]> | NostrEvent | NostrEvent[];

/** A method for requesting events from multiple relays */
export type NostrRequest = (relays: string[], filters: Filter[]) => Observable<NostrEvent>;

/** A flexible type for the upstream relay pool */
export type UpstreamPool = NostrRequest | { request: NostrRequest };

/** A filter that is does not have a since or until */
export type TimelessFilter = Omit<Filter, "since" | "until">;
