import {
  endWith,
  filter,
  ignoreElements,
  merge,
  share,
  takeUntil,
  timeout,
  type ObservableInput,
  type ObservedValueOf,
  type OperatorFunction,
  type TimeoutConfig,
} from "rxjs";

/**
 * Like RxJS `timeout`, but only for emissions that are not ignored.
 *
 * Values that match `config.ignore` are forwarded immediately and do not affect
 * timeout state (`first`/`each`). Timeout timing only observes non-ignored values.
 *
 * Example usage:
 *
 *   source$.pipe(
 *     timeoutWithIgnore({
 *       first: 1500,
 *       each: 1000,
 *       with: () => of(null),
 *       ignore: value => value === undefined,
 *     })
 *   )
 *
 * @param config RxJS timeout config with an additional `ignore` matcher
 * (`(value) => boolean` or array of values) used to bypass timeout checks.
 */
export function timeoutWithIgnore<T, O extends ObservableInput<unknown> = ObservableInput<T>, M = unknown>(
  config: TimeoutConfig<T, O, M> & { ignore: readonly T[] | ((value: T) => boolean) },
): OperatorFunction<T, T | ObservedValueOf<O>> {
  return (source) => {
    const { ignore, ...timeoutConfig } = config;
    const isIgnored = (value: T) => (typeof ignore === "function" ? ignore(value) : ignore.includes(value));
    const shared$ = source.pipe(share());

    const watched$ = shared$.pipe(filter((value) => !isIgnored(value)));
    const ignored$ = shared$.pipe(filter(isIgnored));

    const timed$ = watched$.pipe(timeout(timeoutConfig), share());

    // Stop forwarding ignored values as soon as the timed branch completes/errors.
    return merge(timed$, ignored$).pipe(takeUntil(timed$.pipe(ignoreElements(), endWith(true))));
  };
}
