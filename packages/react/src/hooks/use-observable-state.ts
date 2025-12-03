import { useDebugValue, useEffect, useLayoutEffect, useRef, useState } from "react";
import { BehaviorSubject, Observable, Subscription } from "rxjs";
import { useForceUpdate } from "observable-hooks";

// Prevent React warning when using useLayoutEffect on server
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Symbol to indicate no value was emitted
const NO_VALUE = Symbol("NO_VALUE");

interface SubscriptionState<T> {
  /** The observable this state is for */
  observable: Observable<T>;
  /** The active subscription */
  subscription: Subscription;
  /** Latest value received */
  latestValue: T | typeof NO_VALUE;
  /** Latest error received */
  latestError: unknown;
  /** Callback to update React state - set by useEffect */
  onValue: ((value: T) => void) | null;
  /** Callback to handle errors - set by useEffect */
  onError: (() => void) | null;
}

function createSubscription<T>(observable: Observable<T>): SubscriptionState<T> {
  const subState: SubscriptionState<T> = {
    observable,
    subscription: null as unknown as Subscription,
    latestValue: NO_VALUE,
    latestError: null,
    onValue: null,
    onError: null,
  };

  subState.subscription = observable.subscribe({
    next: (value) => {
      subState.latestValue = value;
      subState.onValue?.(value);
    },
    error: (error) => {
      subState.latestError = error;
      subState.onError?.();
    },
  });

  return subState;
}

/**
 * A hook that subscribes to an Observable and returns its current value.
 *
 * Unlike the standard `useObservableState` from observable-hooks, this hook
 * will synchronously get the initial value if the Observable emits synchronously.
 * This prevents an extra render when the Observable has an immediate value.
 *
 * If the Observable does not emit synchronously, the hook returns `undefined`
 * for the initial render (unlike `useObservableEagerState` which throws).
 *
 * The observable is only subscribed to once - the subscription created during
 * the initial probe is kept alive and reused, avoiding issues with cold observables.
 *
 * @template TState State type.
 * @param state$ An Observable of state values.
 * @returns The current state value, or `undefined` if no value has been emitted yet.
 */
export function useObservableState<TState>(state$: BehaviorSubject<TState>): TState;
export function useObservableState<TState>(state$: Observable<TState>): TState | undefined;
export function useObservableState<TState>(state$: Observable<TState>): TState | undefined {
  const forceUpdate = useForceUpdate();

  // Ref to hold the subscription state - persists across renders
  const subStateRef = useRef<SubscriptionState<TState> | null>(null);

  // Initialize state - this only runs once per component instance
  const [state, setState] = useState<TState | undefined>(() => {
    // Clean up any existing subscription (shouldn't happen in useState init, but be safe)
    if (subStateRef.current) {
      subStateRef.current.subscription.unsubscribe();
    }

    // Create subscription and probe for sync value
    const subState = createSubscription(state$);
    subStateRef.current = subState;

    // Return sync value if available
    return subState.latestValue !== NO_VALUE ? subState.latestValue : undefined;
  });

  // Track current observable for staleness checks
  const state$Ref = useRef(state$);
  useIsomorphicLayoutEffect(() => {
    state$Ref.current = state$;
  });

  // Handle observable changes and register callbacks
  useEffect(() => {
    let subState = subStateRef.current;

    // If observable changed, create new subscription
    if (!subState || subState.observable !== state$) {
      // Clean up old subscription
      subState?.subscription.unsubscribe();

      // Create new subscription
      subState = createSubscription(state$);
      subStateRef.current = subState;

      // Update state if we got a sync value from new observable
      if (subState.latestValue !== NO_VALUE) {
        setState(subState.latestValue);
      } else {
        setState(undefined);
      }
    } else {
      // Same observable - check if we missed any values between useState and useEffect
      if (subState.latestValue !== NO_VALUE && subState.latestValue !== state) {
        setState(subState.latestValue);
      }
    }

    // Check for errors that occurred before useEffect
    if (subState.latestError !== null) {
      forceUpdate();
    }

    // Register callbacks for future emissions
    subState.onValue = (value) => {
      if (state$Ref.current === state$) {
        setState(value);
      }
    };

    subState.onError = () => {
      if (state$Ref.current === state$) {
        forceUpdate();
      }
    };

    return () => {
      // Unregister callbacks
      subState.onValue = null;
      subState.onError = null;

      // Unsubscribe
      subState.subscription.unsubscribe();

      // Clear the ref if this is still the current subscription
      if (subStateRef.current === subState) {
        subStateRef.current = null;
      }
    };
  }, [state$]);

  // Throw errors to be caught by error boundary
  const subState = subStateRef.current;
  if (subState?.latestError !== null && subState?.observable === state$) {
    throw subState.latestError;
  }

  useDebugValue(state);

  return state;
}
