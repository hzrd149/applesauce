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
