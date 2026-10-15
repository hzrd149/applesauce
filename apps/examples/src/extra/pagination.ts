import { loadHistory } from "./history-window";
import type { EventStore } from "applesauce-core";
import { getEventUID, type Filter } from "applesauce-core/helpers";
import type { TimelineLoader } from "applesauce-loaders/loaders";
import { combineLatest, defer, map, type Observable } from "rxjs";

/** Composes pagination status and revision-aware results for the current loader */
export function paginatedTimeline(
  store: EventStore,
  loader: TimelineLoader,
  pages: Observable<void>,
  filters: Filter | Filter[],
) {
  return defer(() => {
    const seen = new Set<string>();
    const requests = loadHistory(loader, pages, (event) => {
      store.add(event);
      seen.add(getEventUID(event));
    });
    return combineLatest([requests, store.timeline(filters)]).pipe(
      map(([status, events]) => ({ ...status, events: events.filter((event) => seen.has(getEventUID(event))) })),
    );
  });
}
