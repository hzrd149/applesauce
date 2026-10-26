import {
  getInboxes,
  getOutboxes,
  kinds,
  mergeRelaySets,
  selectOptimalRelays,
  setFallbackRelays,
  type Filter,
} from "applesauce-core/helpers";
import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import { combineLatest, map, of, type Observable } from "rxjs";
import { configured$ } from "../helpers.js";
import type { KehtoRelaySelectionOptions } from "../types.js";

/** Returns a user's NIP-65 inboxes from the store */
export function getStoredInboxes(eventStore: EventStore, pubkey: string): string[] {
  const list = eventStore.getReplaceable(kinds.RelayList, pubkey);
  return list ? getInboxes(list) : [];
}

/** Returns a user's NIP-65 outboxes from the store */
export function getStoredOutboxes(eventStore: EventStore, pubkey: string): string[] {
  const list = eventStore.getReplaceable(kinds.RelayList, pubkey);
  return list ? getOutboxes(list) : [];
}

/** Limits and health filtering applied when selecting outbox relays for many authors */
export interface KehtoRelaySelection {
  /** The maximum number of relays to connect to (default 12) */
  maxConnections?: number;
  /** The maximum number of relays selected for each author (default 3) */
  maxRelaysPerUser?: number;
  /** A method that removes unhealthy relays from an author's outboxes before selection */
  filterRelays?: (relays: string[]) => string[];
}

/** Observes the host's selection limits, emitting again when the pool's liveness sources change relay health */
export function relaySelection$(
  pool: RelayPool,
  options?: KehtoRelaySelectionOptions,
): Observable<KehtoRelaySelection> {
  const liveness = pool.liveness ?? [];
  const health$ = liveness.length ? combineLatest(liveness.map((source) => source.unhealthy$)) : of([]);

  return combineLatest([
    configured$(options?.maxConnections, 12),
    configured$(options?.maxRelaysPerUser, 3),
    health$,
  ]).pipe(
    map(([maxConnections, maxRelaysPerUser]) => ({
      maxConnections,
      maxRelaysPerUser,
      filterRelays: liveness.length ? (relays: string[]) => pool.filterRelays(relays) : undefined,
    })),
  );
}

/** Returns the current user's outboxes, or the fallback relays when they have none */
export function selectWriteRelays(eventStore: EventStore, pubkey?: string, fallbackRelays: string[] = []): string[] {
  const outboxes = pubkey ? getStoredOutboxes(eventStore, pubkey) : [];
  return outboxes.length ? outboxes : fallbackRelays;
}

/** Picks relays for filters from the authors' stored outboxes, falling back to the user's inboxes and fallback relays */
export function selectReadRelays(
  eventStore: EventStore,
  filters: Filter[],
  pubkey?: string,
  defaults: string[] = [],
  selection: KehtoRelaySelection = {},
): string[] {
  const fallbackRelays = mergeRelaySets(pubkey ? getStoredInboxes(eventStore, pubkey) : [], defaults);
  const authors = [...new Set(filters.flatMap((filter) => filter.authors ?? []))];
  if (authors.length === 0) return fallbackRelays;

  const { maxConnections = 12, maxRelaysPerUser = 3, filterRelays } = selection;
  const users = authors.map((author) => {
    const outboxes = getStoredOutboxes(eventStore, author);
    return { pubkey: author, relays: filterRelays ? filterRelays(outboxes) : outboxes };
  });
  const selected = selectOptimalRelays(setFallbackRelays(users, fallbackRelays), { maxConnections, maxRelaysPerUser });
  return mergeRelaySets(selected.flatMap((user) => user.relays ?? []));
}

/** Selects relays the way kehto's `selectRelayTier` expects: no filters means publishing */
export function selectRelayTier(
  eventStore: EventStore,
  filters: Filter[],
  pubkey?: string,
  fallbackRelays: string[] = [],
  selection?: KehtoRelaySelection,
): string[] {
  return filters.length === 0
    ? selectWriteRelays(eventStore, pubkey, fallbackRelays)
    : selectReadRelays(eventStore, filters, pubkey, fallbackRelays, selection);
}
