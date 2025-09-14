import { NostrEvent } from "nostr-tools";
import { finalize, MonoTypeOperatorFunction, tap } from "rxjs";

import { IEventClaims } from "../event-store/interface.js";

/** keep a claim on any event that goes through this observable, claims are removed when the observable completes */
export function claimEvents<T extends NostrEvent[] | NostrEvent | undefined>(
  claims: IEventClaims,
): MonoTypeOperatorFunction<T> {
  return (source) => {
    const seen = new Set<NostrEvent>();

    return source.pipe(
      // claim all events
      tap((message) => {
        if (message === undefined) return;
        if (Array.isArray(message)) {
          for (const event of message) {
            seen.add(event);
            claims.claim(event, source);
          }
        } else {
          seen.add(message);
          claims.claim(message, source);
        }
      }),
      // remove claims on cleanup
      finalize(() => {
        for (const e of seen) claims.removeClaim(e, source);
      }),
    );
  };
}
