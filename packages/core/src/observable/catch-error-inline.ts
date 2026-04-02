import { catchError, of, OperatorFunction } from "rxjs";

/** Catches any errors and includes them in the observable stream */
export function catchErrorInline<T extends unknown>(): OperatorFunction<T, T | Error> {
  return catchError((err) => (err instanceof Error ? of(err) : of(new Error(err.message))));
}
