import type { RelayPoolLike } from "@kehto/shell";
import type { Filter, NostrEvent } from "applesauce-core/helpers";
import { filter, firstValueFrom, Observable } from "rxjs";
import type { KehtoState } from "./state.js";

/** Streams store matches and live relay events for filters, emitting "EOSE" once every relay has sent its stored events */
export function subscribeThroughStore(
  state: KehtoState,
  relays: string[],
  filters: Filter[],
): Observable<NostrEvent | "EOSE"> {
  const { pool, eventStore } = state.ctx;

  return new Observable<NostrEvent | "EOSE">((subscriber) => {
    let eosed = false;
    const eose = () => {
      if (eosed) return;
      eosed = true;
      subscriber.next("EOSE");
    };

    // The store emits what it already has and every new match, including events other napplets loaded
    const local = eventStore.filters(filters).subscribe((event) => subscriber.next(event));

    const settled = new Set<string>();
    const timer = setTimeout(eose, relays.length ? state.timeout : 0);
    // Raw req() exposes per-relay EOSE, which RelayPool.subscription() hides
    const network = pool.req(relays, filters).subscribe({
      next: (msg) => {
        if (msg.type === "EVENT") eventStore.add(msg.event, msg.from);
        else if (msg.type !== "OPEN" && settled.add(msg.from).size >= relays.length) eose();
      },
      error: () => eose(),
    });

    return () => {
      clearTimeout(timer);
      local.unsubscribe();
      network.unsubscribe();
    };
  });
}

/** Loads filters from relays into the store, then returns the newest matches from the store */
export async function queryThroughStore(state: KehtoState, relays: string[], filters: Filter[], limit = 500) {
  await firstValueFrom(subscribeThroughStore(state, relays, filters).pipe(filter((item) => item === "EOSE")), {
    defaultValue: undefined,
  });
  return [...state.ctx.eventStore.getByFilters(filters)].sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

/** Publishes an event to relays through the store, throwing when no relay accepts it */
export async function publishThroughStore(state: KehtoState, relays: string[], event: NostrEvent) {
  state.ctx.eventStore.add(event);
  const results = await state.ctx.pool.publish(relays, event);
  if (!results.some((r) => r.ok)) throw new Error(results[0]?.message ?? "No relay accepted the event");
  return results;
}

/** Creates a store-backed kehto {@link RelayPoolLike} so every napplet shares the event store and relay connections */
export function createKehtoRelayPool(state: KehtoState): RelayPoolLike {
  return {
    subscription: (relays, filters: Filter[]) => subscribeThroughStore(state, relays, filters),
    request: (relays, filters: Filter[]) => state.ctx.pool.request(relays, filters),
    publish: async (relays, event: NostrEvent) => {
      await publishThroughStore(state, relays, event);
    },
  };
}
