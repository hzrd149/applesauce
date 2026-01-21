import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { BehaviorSubject, type Observable, of, Subscription, take } from "rxjs";

export  function use$<T>(input?: BehaviorSubject<T>): T;
export  function use$<T>(input?: Observable<T> | undefined): T | undefined;
export  function use$<T>(input: () => Observable<T> | undefined, deps: unknown[]): T | undefined;
export  function use$<T>(
  input?: Observable<T> | BehaviorSubject<T> | (() => Observable<T> | undefined),
  deps?: unknown[],
): T | undefined {
  const state$: Observable<T | undefined> = useMemo(
    () => (typeof input === "function" ? input() : input) ?? of(undefined),
    deps ?? [input],
  );

  const valueRef = useRef<T | undefined>(state$ instanceof BehaviorSubject ? state$.getValue() : undefined);
  const subRef = useRef<Subscription | null>(null);

  const subscribe = useCallback(
    (callback: () => void) => {
      // Subscribe if not already subscribed
      if (!subRef.current) {
        subRef.current = state$.subscribe((v) => {
          valueRef.current = v;
          callback();
        });
      }

      return () => {
        subRef.current?.unsubscribe();
        subRef.current = null;
      };
    },
    [state$],
  );

  const getSnapshot = useCallback(() => {
    // Server snapshot
    if (typeof window === "undefined") {
      // On server: use take(1) and don't store the ref
      state$.pipe(take(1)).subscribe((v) => {
        valueRef.current = v;
      });
    } else {
      // During client hydration: create subscription if needed
      if (!subRef.current) {
        subRef.current = state$.subscribe((v) => {
          valueRef.current = v;
        });
      }
    }

    return valueRef.current;
  }, [state$]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
