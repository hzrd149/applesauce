import {
  catchError,
  defaultIfEmpty,
  filter,
  firstValueFrom,
  isObservable,
  Observable,
  of,
  startWith,
  switchMap,
  timer,
  map,
  timeout,
} from "rxjs";

/** Waits for a defined value with a bounded fallback */
export function settle<T>(value$: Observable<T | undefined>, fallback: T, ms: number): Promise<T> {
  return firstValueFrom(
    value$.pipe(
      filter((value): value is T => value !== undefined),
      timeout({ first: ms }),
      catchError(() => of(fallback)),
      defaultIfEmpty(fallback),
    ),
  );
}

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

/** A timestamp window read by pageTimeline, with only the defined bounds present */
export interface TimelineWindow {
  /** The inclusive oldest timestamp */
  since?: number;
  /** The inclusive newest timestamp */
  until?: number;
  /** The maximum number of newest items to read */
  limit?: number;
}

/** Creates a timeline window without undefined bounds, so it can be spread into filters */
function timelineWindow(since?: number, until?: number, limit?: number): TimelineWindow {
  const window: TimelineWindow = {};
  if (since !== undefined) window.since = since;
  if (until !== undefined) window.until = until;
  if (limit !== undefined) window.limit = limit;

  return window;
}

/**
 * Reads a timeline newest first in pages, yielding every item in the window exactly once
 * @throws if a read fails
 */
export async function* pageTimeline<T extends { created_at: number }>(
  read: (window: TimelineWindow) => T[] | Promise<T[]>,
  options: { since?: number; until?: number; pageSize: number },
): AsyncGenerator<T> {
  const { since, pageSize } = options;
  let until = options.until;

  while (until === undefined || since === undefined || until >= since) {
    const page = await read(timelineWindow(since, until, pageSize));
    if (page.length === 0) return;

    // The page may end partway through its oldest second, so read that whole second separately
    const oldest = Math.min(...page.map((item) => item.created_at));
    const newer = page.filter((item) => item.created_at > oldest);
    const oldestSecond = await read(timelineWindow(oldest, oldest));

    yield* newer;
    yield* oldestSecond;

    until = oldest - 1;
  }
}
