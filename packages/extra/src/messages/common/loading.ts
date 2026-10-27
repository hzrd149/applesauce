import type { Filter, NostrEvent } from "applesauce-core/helpers";
import { Observable } from "rxjs";
import type { MessageTransport } from "./types.js";
import { withMessageAuth$ } from "./authentication.js";

/** Streams stored and arriving events with a bounded, aggregate end-of-history marker */
export function subscribeThroughStore(
  context: MessageTransport,
  relays: string[],
  filters: Filter[],
): Observable<NostrEvent | "EOSE"> {
  return new Observable((subscriber) => {
    let emitted = false;
    const emitEose = () => {
      if (emitted) return;
      emitted = true;
      subscriber.next("EOSE");
    };
    const stored = context.eventStore.filters(filters).subscribe((event) => subscriber.next(event));
    let timer = setTimeout(emitEose, relays.length ? (context.timeout ?? 4000) : 0);
    let authenticating = 0;
    const network = withMessageAuth$(context, (auth) =>
      context.pool.subscription(relays, filters, {
        ...auth,
        eventStore: context.eventStore,
        reconnect: true,
        onAuthRequired: async (request) => {
          authenticating++;
          clearTimeout(timer);
          try {
            await auth.onAuthRequired?.(request);
          } finally {
            authenticating--;
            if (!subscriber.closed && authenticating === 0) timer = setTimeout(emitEose, context.timeout ?? 4000);
          }
        },
      }),
    ).subscribe({
      next: (event) => context.eventStore.add(event),
      error: emitEose,
    });
    return () => {
      clearTimeout(timer);
      stored.unsubscribe();
      network.unsubscribe();
    };
  });
}
