import { catchError, defaultIfEmpty, filter, firstValueFrom, isObservable, Observable, of, timeout } from "rxjs";

/** Waits briefly for a defined value, so answers already in the store return immediately */
export function settle<T>(value$: Observable<T | undefined>, fallback: T, ms: number): Promise<T> {
  return firstValueFrom(
    value$.pipe(
      filter((v): v is T => v !== undefined),
      timeout({ first: ms }),
      catchError(() => of(fallback)),
      defaultIfEmpty(fallback),
    ),
  );
}

/** Keeps the latest value of a static value or observable for synchronous kehto callbacks */
export function latest<T>(input: T | Observable<T> | undefined, initial: T) {
  let value = initial;
  if (isObservable(input)) {
    const sub = input.subscribe((v) => (value = v));
    return { get: () => value, stop: () => sub.unsubscribe() };
  }
  if (input !== undefined) value = input;
  return { get: () => value, stop: () => {} };
}

/** Returns the message of an unknown error */
export function errorMessage(err: unknown, fallback = "failed"): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return fallback;
}
