import type { EventStore } from "applesauce-core";
import { kinds } from "applesauce-core/helpers";
import type { Filter } from "applesauce-core/helpers";
import { RelayPool, SyncDirection } from "applesauce-relay";
import type { Debugger } from "debug";
import {
  catchError,
  concat,
  defer,
  distinctUntilChanged,
  EMPTY,
  ignoreElements,
  merge,
  Observable,
  of,
  switchMap,
  tap,
} from "rxjs";
import { map } from "rxjs/operators";

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
  logger: Debugger;
}

/** Stable comparison for two relay arrays (order independent) */
function sameRelays(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i]);
}

/**
 * Probes the relays for NIP-77 (negentropy) support and emits the result.
 * This is purely observational — {@link RelayPool.sync} performs its own filtering.
 */
function probeNegentropySupport(pool: RelayPool, relays: string[], logger: Debugger): Observable<WalletLoaderStatus> {
  return defer(async () => {
    const results = await Promise.all(
      relays.map(async (url) => {
        try {
          const supported = await pool.relay(url).getSupported();
          return [url, !!supported?.includes(77)] as const;
        } catch (error) {
          logger("Failed to fetch NIP-11 for %s: %s", url, (error as Error)?.message ?? error);
          return [url, false] as const;
        }
      }),
    );

    const support = Object.fromEntries(results);
    const capable = results.filter(([, ok]) => ok).map(([url]) => url);
    logger("NIP-77 capable relays: %d/%d %o", capable.length, relays.length, capable);
    return { type: "negentropy-support", support } as WalletLoaderStatus;
  }).pipe(catchError(() => EMPTY));
}

/**
 * Builds a robust loading stream for a wallet's events that emits {@link WalletLoaderStatus} updates.
 *
 * For every change to the relay set it:
 * 1. Probes which relays support NIP-77 negentropy sync.
 * 2. Runs an initial one-shot request to backfill events and signal when the first load completes.
 * 3. Runs a bidirectional negentropy sync (efficient reconciliation + backup of local events) on the
 *    relays that support it. {@link RelayPool.sync} selects the capable relays internally and errors if none do.
 * 4. Opens a live subscription to all relays to keep the wallet up to date. Failures are retried by the pool.
 *
 * All received events are written to the event store and every step emits debug logs. Subscribe to start
 * loading and unsubscribe to tear it down.
 */
export function loadWalletEvents({
  pool,
  eventStore,
  pubkey,
  relays$,
  logger,
}: WalletLoaderOptions): Observable<WalletLoaderStatus> {
  // Negentropy can only reconcile a single filter at a time
  const negentropyFilter: Filter = {
    kinds: [WALLET_KIND, WALLET_TOKEN_KIND, WALLET_HISTORY_KIND],
    authors: [pubkey],
  };

  // The subscription and request also watch for token and history deletions, since users can delete
  // history events and some relays do not honor the original delete events
  const subscriptionFilters: Filter[] = [
    negentropyFilter,
    { kinds: [kinds.EventDeletion], "#k": [String(WALLET_TOKEN_KIND), String(WALLET_HISTORY_KIND)] },
  ];

  return relays$.pipe(
    // Normalize and de-duplicate the relay set
    map((relays) => Array.from(new Set(relays)).sort()),
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

    // Initial one-shot request: backfills events and gives a clean "loaded" signal
    const request$: Observable<WalletLoaderStatus> = concat(
      of<WalletLoaderStatus>({ type: "loading" }),
      pool.request(relays, subscriptionFilters).pipe(
        tap((event) => eventStore.add(event)),
        ignoreElements(),
        catchError((error) => {
          logger("Initial request error: %s", (error as Error)?.message ?? error);
          return of<WalletLoaderStatus>({ type: "error", error: error as Error });
        }),
      ),
      of<WalletLoaderStatus>({ type: "loaded" }),
    );

    // Negentropy sync (both directions): efficient reconciliation + backup of local events upstream
    let synced = 0;
    const negentropy$: Observable<WalletLoaderStatus> = concat(
      of<WalletLoaderStatus>({ type: "syncing" }),
      pool.sync(relays, eventStore, negentropyFilter, SyncDirection.BOTH).pipe(
        tap((event) => {
          eventStore.add(event);
          synced++;
          logger("Synced event %s (kind %d) via negentropy", event.id.slice(0, 8), event.kind);
        }),
        ignoreElements(),
        catchError((error) => {
          logger("Negentropy sync unavailable: %s", (error as Error)?.message ?? error);
          return EMPTY;
        }),
      ),
      defer(() => {
        logger("Negentropy sync complete (%d events)", synced);
        return of<WalletLoaderStatus>({ type: "synced", count: synced });
      }),
    );

    // Live subscription to all relays. Passing the event store adds events and de-duplicates.
    const subscription$: Observable<WalletLoaderStatus> = pool
      .subscription(relays, subscriptionFilters, { eventStore })
      .pipe(
        tap((event) => logger("Received event %s (kind %d) via subscription", event.id.slice(0, 8), event.kind)),
        ignoreElements(),
        catchError((error) => {
          logger("Subscription error: %s", (error as Error)?.message ?? error);
          return EMPTY;
        }),
      );

    return merge(
      of<WalletLoaderStatus>({ type: "relays", relays }),
      probeNegentropySupport(pool, relays, logger),
      request$,
      negentropy$,
      subscription$,
    );
  }
}
