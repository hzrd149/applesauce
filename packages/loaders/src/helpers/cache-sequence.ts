import { NostrEvent } from "applesauce-core/helpers/event";
import { catchError, defer, EMPTY, Observable, Subscriber } from "rxjs";
import { CacheEmission } from "../types.js";
import { isCacheEvent } from "./cache.js";

/** Starts relay loading for unresolved inputs when a cache completes or releases its blocking phase */
export function cacheLoadingSequence<Input>(
  cache: ((inputs: Input[]) => Observable<CacheEmission>) | undefined,
  primary: (inputs: Input[]) => Observable<NostrEvent>,
  matches: (input: Input, event: NostrEvent) => boolean,
): (inputs: Input[]) => Observable<NostrEvent> {
  if (!cache) return primary;

  return (inputs) =>
    new Observable<NostrEvent>((observer) => {
      const missing = new Set(inputs);
      let released = false;
      let cacheComplete = false;
      let primaryComplete = false;

      const completeIfResolved = () => {
        if (primaryComplete && (cacheComplete || missing.size === 0)) observer.complete();
      };

      const deliver = (event: NostrEvent) => {
        for (const input of missing) if (matches(input, event)) missing.delete(input);
        observer.next(event);
        completeIfResolved();
      };

      const release = () => {
        if (released || observer.closed) return;
        released = true;

        const relaySubscriber = new Subscriber<NostrEvent>({
          next: deliver,
          error: (error: unknown) => observer.error(error),
          complete: () => {
            primaryComplete = true;
            completeIfResolved();
          },
        });
        // Attach before subscribing so synchronous completion and downstream cancellation tear down immediately.
        observer.add(relaySubscriber);
        defer(() => primary(Array.from(missing))).subscribe(relaySubscriber);
      };

      const cacheSubscriber = new Subscriber<CacheEmission>({
        next: (emission) => {
          if (isCacheEvent(emission)) deliver(emission);
          else release();
        },
        error: (error: unknown) => observer.error(error),
        complete: () => {
          cacheComplete = true;
          release();
          completeIfResolved();
        },
      });
      observer.add(cacheSubscriber);
      defer(() => cache(inputs))
        .pipe(catchError(() => EMPTY))
        .subscribe(cacheSubscriber);
    });
}
