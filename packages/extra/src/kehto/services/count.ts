import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { Observable } from "rxjs";
import type { CountServiceOptions } from "@kehto/services";
import type { Filter } from "applesauce-core/helpers";
import { combineLatest, defaultIfEmpty, defer, lastValueFrom, switchMap, take, takeUntil, timer } from "rxjs";
import { selectReadRelays } from "../foundation/relays.js";
import { configured$, errorMessage } from "../helpers.js";

/** Options for {@link createCountOptions} */
export interface KehtoCountOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The relay pool used for napplet traffic */
  pool: RelayPool;
  /** The active public key used for server or relay discovery */
  pubkey?: string | Observable<string | undefined>;
  /** The total request budget including settings and relay responses in milliseconds (default 4000) */
  timeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
}

/** Creates {@link CountServiceOptions} that send NIP-45 COUNT requests through the relay pool */
export function createCountOptions(config: KehtoCountOptions): CountServiceOptions {
  return {
    count: async ({ filters }) => {
      try {
        if (!filters.length || filters.some((filter) => Object.keys(filter).length === 0))
          return { ok: false, error: "empty filters are too broad to count" };

        const requestTimeout = config.timeout ?? 4000;
        if (!Number.isFinite(requestTimeout) || requestTimeout <= 0 || requestTimeout > 2_147_483_647)
          return { ok: false, error: "count timeout must be positive and at most 2147483647 ms" };

        const outcomes = await lastValueFrom(
          combineLatest([configured$(config.pubkey, undefined), configured$(config.fallbackRelays, [])]).pipe(
            take(1),
            switchMap(([pubkey, fallbackRelays]) => {
              const relays = selectReadRelays(config.eventStore, filters as Filter[], pubkey, fallbackRelays);
              return defer(() => config.pool.count(relays, filters as Filter[]));
            }),
            // Complete with the latest partial snapshot even when another relay never settles.
            takeUntil(timer(requestTimeout)),
            defaultIfEmpty(undefined),
          ),
        );

        // Report the largest count, since each relay only sees the events it stores
        let largestCount: { relay: string; count: number; approximate?: boolean } | undefined;
        for (const [relay, outcome] of Object.entries(outcomes ?? {})) {
          if (
            outcome.ok &&
            Number.isSafeInteger(outcome.value.count) &&
            outcome.value.count >= 0 &&
            (outcome.value.approximate === undefined || typeof outcome.value.approximate === "boolean") &&
            (!largestCount || outcome.value.count > largestCount.count)
          ) {
            largestCount = { relay, count: outcome.value.count, approximate: outcome.value.approximate };
          }
        }

        if (!largestCount) return { ok: false, error: "no relay answered the count" };

        return {
          ok: true,
          count: largestCount.count,
          approximate: largestCount.approximate ?? false,
          relays: [largestCount.relay],
        };
      } catch (err) {
        return { ok: false, error: errorMessage(err, "count failed") };
      }
    },
    // Empty filters ask every relay to count everything
    isFilterSupported: (filter) => Object.keys(filter).length > 0 || "empty filters are too broad to count",
  };
}
