import { NostrEvent, StoreEvent } from "../helpers/event.js";
import { finalize, MonoTypeOperatorFunction, tap } from "rxjs";

import { IEventClaims } from "../event-store/interface.js";

/** keep a claim on any event that goes through this observable, claims are removed when the observable is unsubscribed or completes */
export function claimEvents<E extends StoreEvent = NostrEvent, T extends E[] | E | undefined = E[] | E | undefined>(
  claims: IEventClaims<E>,
): MonoTypeOperatorFunction<T> {
  return (source) => {
    const seen = new Set<E>();

    return source.pipe(
      // claim all events
      tap((message) => {
        if (message === undefined) return;
        if (Array.isArray(message)) {
          for (const event of message) {
            if (seen.has(event)) continue;

            seen.add(event);
            claims.claim(event);
          }
        } else if (!seen.has(message as E)) {
          seen.add(message as E);
          claims.claim(message as E);
        }
      }),
      // remove claims on cleanup
      finalize(() => {
        for (const e of seen) claims.removeClaim(e);
      }),
    );
  };
}
