import {
  getInboxes,
  getOutboxes,
  kinds,
  mergeRelaySets,
  selectOptimalRelays,
  setFallbackRelays,
  type Filter,
} from "applesauce-core/helpers";
import type { KehtoState } from "./state.js";

/** Returns a user's NIP-65 inboxes from the store */
export function getStoredInboxes(state: KehtoState, pubkey: string): string[] {
  const list = state.ctx.eventStore.getReplaceable(kinds.RelayList, pubkey);
  return list ? getInboxes(list) : [];
}

/** Returns a user's NIP-65 outboxes from the store */
export function getStoredOutboxes(state: KehtoState, pubkey: string): string[] {
  const list = state.ctx.eventStore.getReplaceable(kinds.RelayList, pubkey);
  return list ? getOutboxes(list) : [];
}

/** Returns the current user's outboxes, or the fallback relays when they have none */
export function selectWriteRelays(state: KehtoState): string[] {
  const pubkey = state.getPubkey();
  const outboxes = pubkey ? getStoredOutboxes(state, pubkey) : [];
  return outboxes.length ? outboxes : state.getFallbackRelays();
}

/** Picks relays for filters from the authors' stored outboxes, falling back to the user's inboxes and fallback relays */
export function selectReadRelays(state: KehtoState, filters: Filter[]): string[] {
  const pubkey = state.getPubkey();
  const defaults = mergeRelaySets(pubkey ? getStoredInboxes(state, pubkey) : [], state.getFallbackRelays());
  const authors = [...new Set(filters.flatMap((f) => f.authors ?? []))];
  if (authors.length === 0) return defaults;

  const users = authors.map((author) => ({ pubkey: author, relays: getStoredOutboxes(state, author) }));
  const selected = selectOptimalRelays(setFallbackRelays(users, defaults), { maxConnections: 12, maxRelaysPerUser: 3 });
  return mergeRelaySets(selected.flatMap((u) => u.relays ?? []));
}

/** Selects relays the way kehto's `selectRelayTier` expects: no filters means publishing */
export function selectRelayTier(state: KehtoState, filters: Filter[]): string[] {
  return filters.length === 0 ? selectWriteRelays(state) : selectReadRelays(state, filters);
}
