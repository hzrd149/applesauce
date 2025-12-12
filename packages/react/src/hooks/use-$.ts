import { useMemo } from "react";
import { BehaviorSubject, Observable, of } from "rxjs";
import { useObservableState } from "./use-observable-state.js";

/** A utility hook that combines {@link useObservableState} and useMemo */
export function use$<T>(observable?: BehaviorSubject<T>): T;
export function use$<T>(observable?: Observable<T>): T | undefined;
export function use$<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined;
export function use$<T>(
  observable?: Observable<T> | BehaviorSubject<T> | (() => Observable<T> | undefined),
  deps?: any[],
): T | undefined {
  const resolved = useMemo(
    () => (typeof observable === "function" ? observable() : observable) ?? of(undefined),
    deps ?? [observable],
  );
  return useObservableState(resolved);
}
