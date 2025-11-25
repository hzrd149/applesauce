import { NostrEvent } from "applesauce-core/helpers/event";
import { finalize, MonoTypeOperatorFunction, tap } from "rxjs";

import { IEventClaims } from "../event-store/interface.js";

/** An operator that claims the latest event with the database */
export function claimLatest<T extends NostrEvent | undefined>(claims: IEventClaims): MonoTypeOperatorFunction<T> {
  return (source) => {
    let latest: NostrEvent | undefined = undefined;

    return source.pipe(
      tap((event) => {
        // only update if the event changed
        if (latest !== event) {
          // remove old claim
          if (latest) claims.removeClaim(latest);
          // claim new event
          if (event) claims.claim(event);
          // update state
          latest = event;
        }
      }),
      finalize(() => {
        // remove latest claim
        if (latest) claims.removeClaim(latest);
      }),
    );
  };
}
