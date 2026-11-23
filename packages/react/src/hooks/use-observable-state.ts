import { useDebugValue, useMemo, useSyncExternalStore } from "react";
import { BehaviorSubject, Observable, Subscription } from "rxjs";

const SWEEP_INTERVAL = 1000;

// Two generations give every abandoned render at least one full interval before cleanup.
let pendingReleases = new Set<() => void>();
let expiringReleases = new Set<() => void>();
let sweepTimer: ReturnType<typeof setTimeout> | undefined;

function sweep() {
  for (const release of expiringReleases) release();

  expiringReleases = pendingReleases;
  pendingReleases = new Set();
  sweepTimer = expiringReleases.size > 0 ? setTimeout(sweep, SWEEP_INTERVAL) : undefined;
}

function trackUncommitted(release: () => void) {
  pendingReleases.add(release);
  sweepTimer ??= setTimeout(sweep, SWEEP_INTERVAL);
}

function markCommitted(release: () => void) {
  pendingReleases.delete(release);
  expiringReleases.delete(release);
  // Keep the scheduled sweep so sequential commits don't cancel and recreate timers.
}

type Snapshot<T> = { value?: T; error?: unknown };

/** Wraps an observable in a single subscription that is shared between render and React's subscribe */
function createObservableStore<T>(observable: Observable<T>) {
  let snapshot: Snapshot<T> = {};
  let subscription: Subscription | undefined;
  let listener: (() => void) | undefined;

  const connect = () => {
    if (subscription) return;

    subscription = observable.subscribe({
      next: (value) => {
        if ("value" in snapshot && Object.is(snapshot.value, value)) return;

        snapshot = { value };
        listener?.();
      },
      error: (error) => {
        snapshot = { error };
        listener?.();
      },
    });
  };

  const releaseIfIdle = () => {
    if (listener) return;

    subscription?.unsubscribe();
    subscription = undefined;
  };

  const getSnapshot = () => {
    if (!subscription && !listener) {
      // Keep the render subscription for React's subscribe, and close it if the render never commits
      connect();
      trackUncommitted(releaseIfIdle);
    }

    return snapshot;
  };

  const getServerSnapshot = () => {
    connect();
    releaseIfIdle();

    return snapshot;
  };

  const subscribe = (onChange: () => void) => {
    listener = onChange;
    markCommitted(releaseIfIdle);
    connect();

    return () => {
      listener = undefined;
      releaseIfIdle();
    };
  };

  return { subscribe, getSnapshot, getServerSnapshot };
}

/**
 * Subscribes to an Observable and returns its current value, or `undefined` until it emits
 * @throws the error emitted by the Observable, to be caught by an error boundary
 */
export function useObservableState<TState>(state$: BehaviorSubject<TState>): TState;
export function useObservableState<TState>(state$: Observable<TState>): TState | undefined;
export function useObservableState<TState>(state$: Observable<TState>): TState | undefined {
  const store = useMemo(() => createObservableStore(state$), [state$]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  if ("error" in snapshot) throw snapshot.error;

  useDebugValue(snapshot.value);
  return snapshot.value;
}
