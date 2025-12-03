import { useObservableEagerState } from "observable-hooks";
import { useMemo } from "react";
import { BehaviorSubject, Observable, of } from "rxjs";
import { useObservableState } from "./use-observable-state.js";

/** A hook that recreates an observable when the dependencies change */
export function useObservableMemo<T>(factory: () => BehaviorSubject<T>, deps: any[]): T;
export function useObservableMemo<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined;
export function useObservableMemo<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined {
  return useObservableState(useMemo(() => factory() || of(undefined), deps));
}

/** A hook that recreates a synchronous observable when the dependencies change */
export function useObservableEagerMemo<T>(factory: () => Observable<T>, deps: any[]): T;
export function useObservableEagerMemo<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined;
export function useObservableEagerMemo<T>(factory: () => Observable<T> | undefined, deps: any[]): T | undefined {
  return useObservableEagerState(useMemo(() => factory() || of(undefined), deps));
}
