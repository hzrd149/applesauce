import { connect, filter, MonoTypeOperatorFunction, OperatorFunction, take, takeUntil } from "rxjs";

/**
 * Complete an observable when an operator emits a value
 * @param operator - The operator to apply to the source observable
 * @param check - A method used to check value for completion, defaults to truthy
 */
export function completeWhen<T, U>(
  operator: OperatorFunction<T, U>,
  check: ((v: U) => boolean) | null = (v) => !!v,
): MonoTypeOperatorFunction<T> {
  return connect((shared$) => {
    const complete$ = check ? shared$.pipe(operator, filter(check), take(1)) : shared$.pipe(operator, take(1));

    return shared$.pipe(
      // Complete when the operator returns truthy value
      takeUntil(complete$),
    );
  });
}
