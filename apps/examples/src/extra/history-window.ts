import { unixNow, type NostrEvent } from "applesauce-core/helpers";
import type { TimelineLoader } from "applesauce-loaders/loaders";
import { combineLatest, defer, ignoreElements, map, scan, startWith, tap, type Observable } from "rxjs";

/** Expands an app-owned history range by one day for each request for older content */
export function historyWindows(more: Observable<unknown>, span = 86400) {
  return defer(() => {
    const until = unixNow();
    return more.pipe(
      startWith(undefined),
      scan((since) => Math.max(0, since - span), until),
      map((since) => ({ since, until })),
    );
  });
}

/** Loads expanding time windows and exposes visible loading and failure status */
export function loadHistory(loader: TimelineLoader, more: Observable<unknown>, onEvent?: (event: NostrEvent) => void) {
  return combineLatest([
    loader(historyWindows(more)).pipe(
      tap((event) => onEvent?.(event)),
      ignoreElements(),
      startWith(null),
    ),
    loader.status$.pipe(
      map((statuses) => ({
        loading: statuses.length === 0 || statuses.some((status) => status.state === "loading"),
        error: statuses
          .filter((status) => status.state === "incomplete" && status.reason === "request")
          .map((status) => String(status.error ?? "Incomplete relay coverage"))
          .join("; "),
      })),
    ),
  ]).pipe(map(([, status]) => status));
}
