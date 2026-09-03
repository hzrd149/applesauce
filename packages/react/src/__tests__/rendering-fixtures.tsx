import { Component, ErrorInfo, PropsWithChildren, ReactNode } from "react";
import { Observable, Subscriber } from "rxjs";

export function createControlledObservable<T>() {
  let subscriber: Subscriber<T> | undefined;
  const observable = new Observable<T>((next) => {
    subscriber = next;
  });

  return {
    observable,
    next(value: T) {
      subscriber?.next(value);
    },
    error(error: unknown) {
      subscriber?.error(error);
    },
  };
}

export function createTrackedObservable<T>(syncValue?: T) {
  const subscriptions: Array<{ subscriber: Subscriber<T>; teardowns: number }> = [];
  const observable = new Observable<T>((subscriber) => {
    const record = { subscriber, teardowns: 0 };
    subscriptions.push(record);
    if (arguments.length > 0) subscriber.next(syncValue as T);
    return () => record.teardowns++;
  });

  return {
    observable,
    subscriptions,
    next(value: T) {
      subscriptions.forEach(({ subscriber }) => subscriber.next(value));
    },
    error(error: unknown) {
      subscriptions.forEach(({ subscriber }) => subscriber.error(error));
    },
    get active() {
      return subscriptions.filter(({ subscriber }) => !subscriber.closed).length;
    },
  };
}

interface ErrorBoundaryProps extends PropsWithChildren {
  resetKey?: unknown;
  fallback?: ReactNode;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, { error: unknown }> {
  state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  componentDidCatch(_error: unknown, _info: ErrorInfo) {}

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    return this.state.error ? (this.props.fallback ?? <span>error</span>) : this.props.children;
  }
}
