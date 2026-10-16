import { catchError, defer, EMPTY, Observable, throwError, timeout, finalize } from "rxjs";
import type { CountContext } from "../../loaders/count-sources/types.js";

/** Starts selection timing before admission and response timing only after dispatch */
export function admitCountTransport<T>(
  context: CountContext,
  resources: readonly string[],
  endpoint: string,
  transport: () => Observable<T>,
  attemptKey = endpoint,
): Observable<T> {
  if (!context.routed) return context.transport.run(resources, transport);
  if (context.attempts?.has(attemptKey)) return EMPTY;
  return new Observable<T>((subscriber) => {
    const queuedAt = context.clock.now();
    const wait = context.clock.schedule(
      () => subscriber.error(new Error("Count selection wait expired")),
      Math.max(1, Math.min(context.selectionTimeout ?? 1000, context.deadline - context.clock.now())),
    );
    subscriber.add(wait);
    subscriber.add(
      context.transport
        .run(resources, () => {
          wait.unsubscribe();
          if (context.runtime && !context.runtime.healthy(endpoint)) return EMPTY;
          if (context.attempts?.has(attemptKey)) return EMPTY;
          context.attempts?.add(attemptKey);
          const dispatchedAt = context.clock.now();
          context.diagnostic?.("capacity-wait", dispatchedAt - queuedAt);
          context.diagnostic?.("dispatched");
          return defer(transport).pipe(
            timeout({
              first: Math.max(1, Math.min(context.attemptTimeout, context.deadline - context.clock.now())),
              scheduler: context.clock,
            }),
            finalize(() => context.diagnostic?.("transport-duration", context.clock.now() - dispatchedAt)),
            catchError((error) => {
              context.runtime?.failure(endpoint);
              return throwError(() => error);
            }),
          );
        })
        .subscribe(subscriber),
    );
  });
}
