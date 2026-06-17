import type { EventStore } from "applesauce-core";
import { kinds, relaySet } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";
import { createSyncLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import type { Debugger } from "debug";
import {
  catchError,
  concat,
  distinctUntilChanged,
  EMPTY,
  ignoreElements,
  merge,
  Observable,
  of,
  switchMap,
  tap,
} from "rxjs";
import { filter, map } from "rxjs/operators";

import { WALLET_HISTORY_KIND } from "../helpers/history.js";
import { WALLET_TOKEN_KIND } from "../helpers/tokens.js";
import { WALLET_KIND } from "../helpers/wallet.js";

/** A status update emitted while loading a wallet's events */
export type WalletLoaderStatus =
  | { type: "relays"; relays: string[] }
  | { type: "negentropy-support"; support: Record<string, boolean> }
  | { type: "loading" }
  | { type: "loaded" }
  | { type: "syncing" }
  | { type: "synced"; count: number }
  | { type: "error"; error: Error };

export interface WalletLoaderOptions {
  pool: RelayPool;
  eventStore: EventStore;
  pubkey: string;
  /** An observable of the relays to load wallet events from */
  relays$: Observable<string[]>;
  /**
   * Whether to load and subscribe to NIP-09 delete events for the wallet's events (default false).
   * When false, kind-5 delete events are never fetched, so the event store never applies them and the
   * wallet completely ignores any deletes published for its wallet, token and history events.
   */
  useDeleteEvents?: boolean;
  logger: Debugger;
}

/** Stable comparison for two relay arrays (order independent) */
function sameRelays(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i]);
}

/**
 * Builds a robust loading stream for a wallet's events that emits {@link WalletLoaderStatus} updates.
 *
 * For every change to the relay set it:
 * 1. Backfills wallet, token, history and (when {@link WalletLoaderOptions.useDeleteEvents} is enabled)
 *    delete events with NIP-77 sync or paginated requests.
 * 2. Opens a live subscription to all relays to keep the wallet up to date. Failures are retried by the pool.
 *
 * All received events are written to the event store and every step emits debug logs. Subscribe to start
 * loading and unsubscribe to tear it down.
 */
export function loadWalletEvents({
  pool,
  eventStore,
  pubkey,
  relays$,
  useDeleteEvents = false,
  logger,
}: WalletLoaderOptions): Observable<WalletLoaderStatus> {
  // Negentropy can only reconcile a single filter at a time
  const negentropyFilter: Filter = {
    kinds: [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND],
    authors: [pubkey],
  };
  const walletEventKinds = [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND];
  const deleteFilter: Filter = { kinds: [kinds.EventDeletion], "#k": walletEventKinds.map(String) };

  // The subscription and request also watch for wallet event deletions, unless they are disabled
  const subscriptionFilters: Filter[] = useDeleteEvents ? [negentropyFilter, deleteFilter] : [negentropyFilter];
  const syncLoader = createSyncLoader({ pool, eventStore, logger });

  return relays$.pipe(
    // Normalize and de-duplicate the relay set
    map((relays) => relaySet(relays).sort()),
    distinctUntilChanged(sameRelays),
    // Restart loading whenever the relay set changes
    switchMap((relays) => buildLoaders(relays)),
  );

  function buildLoaders(relays: string[]): Observable<WalletLoaderStatus> {
    if (relays.length === 0) {
      logger("Waiting for relays before loading wallet events");
      return of({ type: "loaded" } as WalletLoaderStatus);
    }

    logger("Loading wallet events from %d relays %o", relays.length, relays);

    const walletLoad = syncLoader({ relays, filter: negentropyFilter });
    const deleteLoad = useDeleteEvents ? syncLoader({ relays, filter: deleteFilter }) : undefined;
    const walletStatus$ = walletLoad.status$;

    const support$: Observable<WalletLoaderStatus> = walletStatus$.pipe(
      filter((status) => Object.values(status.relays).every((relay) => relay.negentropy !== undefined)),
      map((status) =>
        Object.fromEntries(Object.entries(status.relays).map(([url, relay]) => [url, !!relay.negentropy])),
      ),
      distinctUntilChanged(
        (a, b) => sameRelays(Object.keys(a), Object.keys(b)) && Object.keys(a).every((url) => a[url] === b[url]),
      ),
      map((support) => ({ type: "negentropy-support", support }) as WalletLoaderStatus),
    );

    const errors$: Observable<WalletLoaderStatus> = merge(
      walletStatus$,
      ...(deleteLoad ? [deleteLoad.status$] : []),
    ).pipe(
      switchMap((status) => Object.values(status.relays).filter((relay) => relay.state === "error" && relay.error)),
      map((relay) => ({ type: "error", error: relay.error! }) as WalletLoaderStatus),
    );

    let loaded = 0;
    const events$ = merge(walletLoad.events$, ...(deleteLoad ? [deleteLoad.events$] : [])).pipe(
      tap(() => loaded++),
      ignoreElements(),
    );

    const sync$: Observable<WalletLoaderStatus> = concat(
      of<WalletLoaderStatus>({ type: "loading" }),
      of<WalletLoaderStatus>({ type: "syncing" }),
      merge(events$, support$, errors$),
      of<WalletLoaderStatus>({ type: "loaded" }),
      of<WalletLoaderStatus>({ type: "synced", count: loaded }),
    );

    // Live subscription to all relays. Passing the event store adds events and de-duplicates.
    const subscription$: Observable<WalletLoaderStatus> = pool
      .subscription(relays, subscriptionFilters, { eventStore })
      .pipe(
        ignoreElements(),
        catchError((error) => {
          logger("Subscription error: %s", (error as Error)?.message ?? error);
          return EMPTY;
        }),
      );

    return merge(of<WalletLoaderStatus>({ type: "relays", relays }), sync$, subscription$);
  }
}
