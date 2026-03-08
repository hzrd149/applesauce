import { filter, identity, MonoTypeOperatorFunction, OperatorFunction, Subject, takeUntil, tap } from "rxjs";

/**
 * Complete an observable when an operator emits a value
 * @param operator - The operator to apply to the source observable
 * @param check - A method used to check value for completion, defaults to truthy
 */
export function completeWhen<T>(
  operator: OperatorFunction<T, any>,
  check = (v: any) => !!v,
): MonoTypeOperatorFunction<T> {
  return (source) => {
    const value$ = new Subject<any>();

    return source.pipe(
      // Complete when the operator returns truthy value
      takeUntil(
        value$.pipe(
          // Apply operator
          operator,
          // Check the value
          check ? filter(check) : identity,
        ),
      ),
      // Pass value to subject for other operators to use
      tap((v) => value$.next(v)),
    );
  };
}
