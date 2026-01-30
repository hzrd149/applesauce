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

// export function use$<T>(input?: BehaviorSubject<T>): T;
// export function use$<T>(input?: Observable<T> | undefined): T | undefined;
// export function use$<T>(input: () => Observable<T> | undefined, deps: unknown[]): T | undefined;
// export function use$<T>(
//   input?: Observable<T> | BehaviorSubject<T> | (() => Observable<T> | undefined),
//   deps?: unknown[],
// ): T | undefined {
//   const state$: Observable<T | undefined> = useMemo(
//     () => (typeof input === "function" ? input() : input) ?? of(undefined),
//     deps ?? [input],
//   );

//   const valueRef = useRef<T | undefined>(state$ instanceof BehaviorSubject ? state$.getValue() : undefined);
//   const subRef = useRef<Subscription | null>(null);
//   const callbackRef = useRef<(() => void) | null>(null);

//   const subscribe = useCallback(
//     (callback: () => void) => {
//       // Store the callback
//       callbackRef.current = callback;

//       // Subscribe if not already subscribed
//       if (!subRef.current) {
//         subRef.current = state$.subscribe((v) => {
//           valueRef.current = v;
//           callbackRef.current?.();
//         });
//       }

//       return () => {
//         subRef.current?.unsubscribe();
//         subRef.current = null;
//         callbackRef.current = null;
//       };
//     },
//     [state$],
//   );

//   const getSnapshot = useCallback(() => {
//     let inSnapshot = true;

//     // Server snapshot
//     if (typeof window === "undefined") {
//       // On server: use take(1) and don't store the ref
//       state$.pipe(take(1)).subscribe((v) => {
//         valueRef.current = v;
//       });
//     } else if (!subRef.current) {
//       // Create subscription if needed to get the initial value
//       subRef.current = state$.subscribe((v) => {
//         valueRef.current = v;

//         // Call the callback if it exists (set by subscribe)
//         if (!inSnapshot) callbackRef.current?.();
//       });
//     }

//     inSnapshot = false;
//     return valueRef.current;
//   }, [state$]);

//   return useSyncExternalStore(subscribe, getSnapshot);
// }
