import { concatMap, defer, map, merge, Observable, of, ReplaySubject, shareReplay, takeUntil } from "rxjs";
import { kehtoAccount$, type KehtoAccount } from "../../foundation/account.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import type { DmProtocolAdapter, DmProtocolSession } from "./types.js";

/** Adapts an account-scoped messages client to Kehto's reactive session lifecycle */
export function createClientProtocol(
  config: NostrMessageProtocolOptions,
  id: string,
  createSession: (account: KehtoAccount) => (DmProtocolSession & { dispose(): void }) | undefined,
): DmProtocolAdapter {
  const closed$ = new ReplaySubject<void>(1);
  let closed = false;
  let account: KehtoAccount | undefined;
  let session: (DmProtocolSession & { dispose(): void }) | undefined;
  const session$ = defer(() => (closed ? of(undefined) : kehtoAccount$(config))).pipe(
    map((next) => {
      let retired: typeof session;
      if (account?.pubkey !== next?.pubkey || account?.signer !== next?.signer) {
        retired = session;
        session = undefined;
        account = next;
        if (next) session = createSession(next);
      }
      return { session, retired };
    }),
    // Invalidate the Kehto session before completing its client's pending history reads.
    concatMap(
      ({ session, retired }) =>
        new Observable<DmProtocolSession | undefined>((subscriber) => {
          subscriber.next(session);
          retired?.dispose();
          subscriber.complete();
        }),
    ),
    takeUntil(closed$),
  );
  return {
    id,
    session$: merge(session$, closed$.pipe(map(() => undefined))).pipe(shareReplay({ bufferSize: 1, refCount: true })),
    close: () => {
      if (closed) return;
      closed = true;
      closed$.next();
      session?.dispose();
      account = undefined;
      session = undefined;
      closed$.complete();
    },
  };
}
