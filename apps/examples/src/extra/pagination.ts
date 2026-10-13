import type { EventStore } from "applesauce-core";
import { getEventUID, type Filter } from "applesauce-core/helpers";
import type { TimelineLoader } from "applesauce-loaders/loaders";
import { combineLatest, defer, exhaustMap, map, materialize, scan, startWith, type Observable } from "rxjs";

/** Composes pagination status and revision-aware results for the current loader */
export function paginatedTimeline(
  store: EventStore,
  loader: TimelineLoader,
  pages: Observable<void>,
  filters: Filter | Filter[],
) {
  return defer(() => {
    const seen = new Set<string>();
    const initial = { loading: true, error: undefined as string | undefined };
    const requests = pages.pipe(
      startWith(undefined),
      exhaustMap(() =>
        loader().pipe(
          materialize(),
          scan((state, notification) => {
            if (notification.kind === "E")
              return { loading: false, error: String(notification.error?.message ?? notification.error) };
            if (notification.kind === "C") return { ...state, loading: false };
            store.add(notification.value);
            seen.add(getEventUID(notification.value));
            return state;
          }, initial),
          startWith(initial),
        ),
      ),
    );
    return combineLatest([requests, store.timeline(filters)]).pipe(
      map(([status, events]) => ({ ...status, events: events.filter((event) => seen.has(getEventUID(event))) })),
    );
  });
}
