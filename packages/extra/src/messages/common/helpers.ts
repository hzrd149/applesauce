import type { Filter } from "applesauce-core/helpers";
import { catchError, defaultIfEmpty, isObservable, map, Observable, of, startWith, switchMap, timer } from "rxjs";

/** Observes a configured value or its default */
export function configured$<T>(input: T | Observable<T> | undefined, fallback: T): Observable<T> {
  return isObservable(input) ? input : of(input ?? fallback);
}

/** Observes defined values with a delayed fallback while continuing to follow updates */
export function withFallback$<T>(source$: Observable<T | undefined>, fallback: T, ms: number): Observable<T> {
  return source$.pipe(
    startWith(undefined),
    switchMap((value) => (value === undefined ? timer(ms).pipe(map(() => fallback)) : of(value))),
    defaultIfEmpty(fallback),
    catchError(() => of(fallback)),
  );
}

/** Narrows filters to a timestamp window, adding only the defined bounds */
function windowFilters(filters: Filter[], since?: number, until?: number, limit?: number): Filter[] {
  const bounds: Filter = {
    ...(since !== undefined ? { since } : {}),
    ...(until !== undefined ? { until } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };

  return filters.map((filter) => ({ ...filter, ...bounds }));
}

/**
 * Reads a timeline newest first in pages, yielding every item matching the filters exactly once
 * @throws if a read fails
 */
export async function* pageTimeline<T extends { created_at: number }>(
  filters: Filter[],
  read: (filters: Filter[]) => T[] | Promise<T[]>,
  options: { since?: number; until?: number; pageSize: number },
): AsyncGenerator<T> {
  const { since, pageSize } = options;
  let until = options.until;

  while (until === undefined || since === undefined || until >= since) {
    const page = await read(windowFilters(filters, since, until, pageSize));
    if (page.length === 0) return;

    // The page may end partway through its oldest second, so read that whole second separately
    const oldest = Math.min(...page.map((item) => item.created_at));
    const newer = page.filter((item) => item.created_at > oldest);
    const oldestSecond = await read(windowFilters(filters, oldest, oldest));

    yield* newer;
    yield* oldestSecond;

    until = oldest - 1;
  }
}
