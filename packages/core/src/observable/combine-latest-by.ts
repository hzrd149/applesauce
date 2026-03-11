import { combineLatest, connect, Observable, type OperatorFunction } from "rxjs";

/** Operator object type: one branch operator per output key. */
type CombineLatestByObjectOperators<Input, Output extends Record<string, unknown>> = {
  [K in keyof Output]: OperatorFunction<Input, Output[K]>;
};

/** Operator tuple type: one branch operator per output index. */
type CombineLatestByArrayOperators<Input, Output extends readonly unknown[]> = {
  [K in keyof Output]: OperatorFunction<Input, Output[K]>;
};

/**
 * Branches a source through multiple operators and combines branch outputs with
 * `combineLatest` semantics.
 */
export function combineLatestBy<Input, Output extends Record<string, unknown>>(
  operators: CombineLatestByObjectOperators<Input, Output>,
): OperatorFunction<Input, Output>;
export function combineLatestBy<Input, Output extends readonly unknown[]>(
  operators: CombineLatestByArrayOperators<Input, Output>,
): OperatorFunction<Input, Output>;
export function combineLatestBy<Input>(
  operators: Record<string, OperatorFunction<Input, unknown>> | readonly OperatorFunction<Input, unknown>[],
): OperatorFunction<Input, unknown> {
  return connect((shared$) => {
    if (Array.isArray(operators)) {
      const branches = operators.map((op) => shared$.pipe(op));
      return combineLatest(branches);
    }

    const objectOperators = operators as Record<string, OperatorFunction<Input, unknown>>;
    const branches = Object.fromEntries(Object.entries(objectOperators).map(([key, op]) => [key, shared$.pipe(op)]));
    return combineLatest(branches) as Observable<Record<string, unknown>>;
  });
}
