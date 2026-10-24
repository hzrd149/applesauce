import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { Observable } from "rxjs";
import type { CountServiceOptions } from "@kehto/services";
import type { Filter } from "applesauce-core/helpers";
import { firstValueFrom, lastValueFrom, timeout } from "rxjs";
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
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
}

/** Creates {@link CountServiceOptions} that send NIP-45 COUNT requests through the relay pool */
export function createCountOptions(config: KehtoCountOptions): CountServiceOptions {
  return {
    count: async ({ filters }) => {
      try {
        const pubkey = await firstValueFrom(configured$(config.pubkey, undefined));
        const fallbackRelays = await firstValueFrom(configured$(config.fallbackRelays, []));
        const relays = selectReadRelays(config.eventStore, filters as Filter[], pubkey, fallbackRelays);

        const outcomes = await lastValueFrom(
          config.pool.count(relays, filters as Filter[]).pipe(timeout({ first: config.timeout ?? 4000 })),
        );

        // Report the largest count, since each relay only sees the events it stores
        let largestCount: { relay: string; count: number; approximate?: boolean } | undefined;
        for (const [relay, outcome] of Object.entries(outcomes)) {
          if (outcome.ok && (!largestCount || outcome.value.count > largestCount.count)) {
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
