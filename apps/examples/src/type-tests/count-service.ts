import type { TrustedProviderList, User } from "applesauce-common/casts";
import type { ChainableObservable } from "applesauce-core/observable";
import type { NostrEvent } from "applesauce-core/helpers";
import { createCountService, nip85CountSource, relayCountSource } from "applesauce-loaders/loaders";
import type { CountState } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import { Observable, of, switchMap } from "rxjs";

/** Checks public API composition without adding runtime package dependencies */
export function countServiceIntegration(pool: RelayPool, user: User, event: NostrEvent) {
  const sources = [
    nip85CountSource({
      request: pool.request.bind(pool),
      providers: (kind, tag) =>
        user.trustedProviders$.pipe(
          switchMap((list: TrustedProviderList | undefined) => (list ? list.providersFor$(kind, tag) : of([]))),
        ),
    }),
    relayCountSource({ count: pool.count.bind(pool), relays: of(["wss://relay.test/"]) }),
  ];
  const service = createCountService({ sources, ttl: ({ age }) => (age < 3600 ? 30000 : 300000) });
  const note = service.event(event);
  note.reactions satisfies ChainableObservable<CountState>;
  note.reactions$ satisfies Observable<number | undefined>;
  note.reactions.refreshing satisfies Observable<boolean>;
  note.reactions.origin satisfies Observable<CountState["origin"]>;
  return service;
}
