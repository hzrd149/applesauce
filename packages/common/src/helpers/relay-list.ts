import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

export const FAVORITE_RELAYS_KIND = 10012;

export type FavoriteRelaysListEvent = KnownEvent<typeof FAVORITE_RELAYS_KIND>;
export type SearchRelaysListEvent = KnownEvent<typeof kinds.SearchRelaysList>;
export type BlockedRelaysListEvent = KnownEvent<typeof kinds.BlockedRelaysList>;
export type DMRelaysListEvent = KnownEvent<typeof kinds.DirectMessageRelaysList>;

/** Validates that an event is a valid favorite relays list (kind 10012) */
export function isValidFavoriteRelaysList(event: NostrEvent): event is FavoriteRelaysListEvent {
  return event.kind === FAVORITE_RELAYS_KIND;
}

/** Validates that an event is a valid search relays list (kind 10007) */
export function isValidSearchRelaysList(event: NostrEvent): event is SearchRelaysListEvent {
  return event.kind === kinds.SearchRelaysList;
}

/** Validates that an event is a valid blocked relays list (kind 10006) */
export function isValidBlockedRelaysList(event: NostrEvent): event is BlockedRelaysListEvent {
  return event.kind === kinds.BlockedRelaysList;
}

/** Validates that an event is a valid DM relays list (kind 10050) */
export function isValidDirectMessageRelaysList(event: NostrEvent): event is DMRelaysListEvent {
  return event.kind === kinds.DirectMessageRelaysList;
}
