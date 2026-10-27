import { catchError, defaultIfEmpty, filter, firstValueFrom, isObservable, Observable, of, timeout } from "rxjs";

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
