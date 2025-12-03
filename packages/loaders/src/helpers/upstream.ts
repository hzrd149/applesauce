import { NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { Observable } from "rxjs";
import { NostrRequest, UpstreamPool } from "../types.js";

/** Makes a nostr request on the upstream pool */
export function makeUpstreamRequest(pool: UpstreamPool, relays: string[], filters: Filter[]): Observable<NostrEvent> {
  if (typeof pool === "function") return pool(relays, filters);
  else if (typeof pool === "object" && "request" in pool) return pool.request(relays, filters);
  else throw new Error("Invalid upstream pool");
}

/** Wraps an upstream pool and returns a NostrRequest */
export function wrapUpstreamPool(pool: UpstreamPool): NostrRequest {
  return (relays: string[], filters: Filter[]) => makeUpstreamRequest(pool, relays, filters);
}
