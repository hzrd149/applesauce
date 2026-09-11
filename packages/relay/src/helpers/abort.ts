import { Observable } from "rxjs";

/** Converts an AbortSignal into an observable that emits once and completes when the signal aborts */
export function fromAbortSignal(signal: AbortSignal): Observable<void> {
  return new Observable<void>((subscriber) => {
    // Emit synchronously so `takeUntil` completes without ever subscribing its source
    if (signal.aborted) {
      subscriber.next();
      subscriber.complete();
      return;
    }

    const abort = () => {
      subscriber.next();
      subscriber.complete();
    };
    signal.addEventListener("abort", abort, { once: true });
    return () => signal.removeEventListener("abort", abort);
  });
}
