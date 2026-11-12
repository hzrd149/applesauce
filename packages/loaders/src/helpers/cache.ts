import { markFromCache, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { defer, filter, from, isObservable, Observable, of, switchMap, tap } from "rxjs";
import { CacheEmission, CacheRequest } from "../types.js";

/** Checks whether a cache emission is an event rather than a release signal */
export function isCacheEvent(emission: CacheEmission): emission is NostrEvent {
  return !("type" in emission && emission.type === "release");
}

/** Requests cache events lazily, preserving release signals and marking only events as cached */
export function streamCacheRequest(request: CacheRequest, filters: Filter[]): Observable<CacheEmission> {
  return defer(() => {
    const result = request(filters);
    if (isObservable(result)) return result;
    if (result instanceof Promise)
      return from(result).pipe(switchMap((events) => (Array.isArray(events) ? from(events) : of(events))));
    return Array.isArray(result) ? from(result) : of(result);
  }).pipe(
    tap((emission) => {
      if (isCacheEvent(emission)) markFromCache(emission);
    }),
  );
}

/** Requests cache events while filtering out optional release signals */
export function unwrapCacheRequest(request: CacheRequest, filters: Filter[]): Observable<NostrEvent> {
  return streamCacheRequest(request, filters).pipe(filter(isCacheEvent));
}

/** Calls a cache request method with filters and marks all returned events as being from the cache */
export function makeCacheRequest(request: CacheRequest, filters: Filter[]): Observable<NostrEvent> {
  return unwrapCacheRequest(request, filters);
}
