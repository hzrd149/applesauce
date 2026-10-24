import type { CountServiceOptions } from "@kehto/services";
import type { Filter } from "applesauce-core/helpers";
import { lastValueFrom, timeout } from "rxjs";
import { selectReadRelays } from "../foundation/relays.js";
import type { KehtoState } from "../foundation/state.js";
import { errorMessage } from "../helpers.js";

/** Creates {@link CountServiceOptions} that send NIP-45 COUNT requests through the relay pool */
export function createCountOptions(state: KehtoState): CountServiceOptions {
  return {
    count: async ({ filters }) => {
      const relays = selectReadRelays(state, filters as Filter[]);
      try {
        const outcomes = await lastValueFrom(
          state.ctx.pool.count(relays, filters as Filter[]).pipe(timeout({ first: state.timeout })),
        );
        // Report the largest count, since each relay only sees the events it stores
        let best: { relay: string; count: number; approximate?: boolean } | undefined;
        for (const [relay, outcome] of Object.entries(outcomes)) {
          if (outcome.ok && (!best || outcome.value.count > best.count))
            best = { relay, count: outcome.value.count, approximate: outcome.value.approximate };
        }
        if (!best) return { ok: false, error: "no relay answered the count" };
        return { ok: true, count: best.count, approximate: best.approximate ?? false, relays: [best.relay] };
      } catch (err) {
        return { ok: false, error: errorMessage(err, "count failed") };
      }
    },
    // Empty filters ask every relay to count everything
    isFilterSupported: (filter) => Object.keys(filter).length > 0 || "empty filters are too broad to count",
  };
}
