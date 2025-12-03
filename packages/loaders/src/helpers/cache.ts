import { markFromCache, NostrEvent } from "applesauce-core/helpers/event";
import { Filter } from "applesauce-core/helpers/filter";
import { from, isObservable, Observable, of, switchMap, tap } from "rxjs";
import { CacheRequest } from "../types.js";

/** Calls the cache request and converts the reponse into an observable */
export function unwrapCacheRequest(request: CacheRequest, filters: Filter[]): Observable<NostrEvent> {
  const result = request(filters);

  if (isObservable(result)) return result;
  else if (result instanceof Promise) {
    return from(result).pipe(
      switchMap((v) => (Array.isArray(v) ? from(v) : of(v))),
      tap((e) => markFromCache(e)),
    );
  } else if (Array.isArray(result)) {
    for (const event of result) markFromCache(event);
    return from(result);
  } else {
    markFromCache(result);
    return of(result);
  }
}

/** Calls a cache request method with filters and marks all returned events as being from the cache */
export function makeCacheRequest(request: CacheRequest, filters: Filter[]): Observable<NostrEvent> {
  return unwrapCacheRequest(request, filters);
}
