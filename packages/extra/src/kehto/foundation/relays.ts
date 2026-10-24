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
): string[] {
  const fallbackRelays = mergeRelaySets(pubkey ? getStoredInboxes(eventStore, pubkey) : [], defaults);
  const authors = [...new Set(filters.flatMap((filter) => filter.authors ?? []))];
  if (authors.length === 0) return fallbackRelays;

  const users = authors.map((author) => ({ pubkey: author, relays: getStoredOutboxes(eventStore, author) }));
  const selected = selectOptimalRelays(setFallbackRelays(users, fallbackRelays), {
    maxConnections: 12,
    maxRelaysPerUser: 3,
  });
  return mergeRelaySets(selected.flatMap((user) => user.relays ?? []));
}

/** Selects relays the way kehto's `selectRelayTier` expects: no filters means publishing */
export function selectRelayTier(
  eventStore: EventStore,
  filters: Filter[],
  pubkey?: string,
  fallbackRelays: string[] = [],
): string[] {
  return filters.length === 0
    ? selectWriteRelays(eventStore, pubkey, fallbackRelays)
    : selectReadRelays(eventStore, filters, pubkey, fallbackRelays);
}
