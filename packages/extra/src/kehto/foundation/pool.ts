import type { RelayPoolLike } from "@kehto/shell";
import type { Filter, NostrEvent } from "applesauce-core/helpers";
import { concatMap, filter, firstValueFrom, Observable, of } from "rxjs";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";

/** Store and transport dependencies for napplet relay traffic */
export interface KehtoPoolContext {
  /** The shared event store */
  eventStore: EventStore;
  /** The relay pool for network traffic */
  pool: RelayPool;
  /** The wait for relay responses in milliseconds (default 4000) */
  timeout?: number;
}

/** Streams store matches and live relay events for filters, emitting "EOSE" once every relay has sent its stored events */
export function subscribeThroughStore(
  context: KehtoPoolContext,
  relays: string[],
  filters: Filter[],
): Observable<NostrEvent | "EOSE"> {
  const { pool, eventStore } = context;

  return new Observable<NostrEvent | "EOSE">((subscriber) => {
    let hasEmittedEose = false;
    const emitEose = () => {
      if (hasEmittedEose) return;
      hasEmittedEose = true;
      subscriber.next("EOSE");
    };

    // The store emits what it already has and every new match, including events other napplets loaded
    const storeSubscription = eventStore.filters(filters).subscribe((event) => subscriber.next(event));

    const settled = new Set<string>();
    const timer = setTimeout(emitEose, relays.length ? (context.timeout ?? 4000) : 0);
    // Raw req() exposes per-relay EOSE, which RelayPool.subscription() hides
    const relaySubscription = pool.req(relays, filters).subscribe({
      next: (message) => {
        if (message.type === "EVENT") {
          eventStore.add(message.event, message.from);
        } else if (message.type !== "OPEN") {
          settled.add(message.from);
          if (settled.size >= relays.length) emitEose();
        }
      },
      error: () => emitEose(),
    });

    return () => {
      clearTimeout(timer);
      storeSubscription.unsubscribe();
      relaySubscription.unsubscribe();
    };
  });
}

/** Loads filters from relays into the store, then returns the newest matches from the store */
export async function queryThroughStore(context: KehtoPoolContext, relays: string[], filters: Filter[], limit = 500) {
  await firstValueFrom(subscribeThroughStore(context, relays, filters).pipe(filter((item) => item === "EOSE")), {
    defaultValue: undefined,
  });

  const events = [...context.eventStore.getByFilters(filters)];
  return events.sort((a, b) => b.created_at - a.created_at).slice(0, limit);
}

/**
 * Publishes an event to relays through the store
 * @throws if publishing fails or no relay accepts the event
 */
export async function publishThroughStore(context: KehtoPoolContext, relays: string[], event: NostrEvent) {
  context.eventStore.add(event);
  const results = await context.pool.publish(relays, event);

  if (!results.some((result) => result.ok)) {
    throw new Error(results[0]?.message ?? "No relay accepted the event");
  }

  return results;
}

/** Creates a store-backed kehto {@link RelayPoolLike} so every napplet shares the event store and relay connections */
export function createKehtoRelayPool(
  context: KehtoPoolContext,
  decrypt: (event: NostrEvent) => Observable<NostrEvent> = (event) => of(event),
): RelayPoolLike {
  return {
    // Serialize delivery so EOSE follows every event received before it.
    subscription: (relays, filters: Filter[]) =>
      subscribeThroughStore(context, relays, filters).pipe(
        concatMap((item) => (item === "EOSE" ? of(item) : decrypt(item))),
      ),
    request: (relays, filters: Filter[]) =>
      context.pool.request(relays, filters).pipe(concatMap((event) => decrypt(event))),
    publish: async (relays, event: NostrEvent) => {
      await publishThroughStore(context, relays, event);
    },
  };
}
