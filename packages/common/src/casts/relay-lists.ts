import { defined, watchEventUpdates } from "applesauce-core";
import { hasHiddenTags, HiddenContentSigner, isHiddenTagsUnlocked, unlockHiddenTags } from "applesauce-core/helpers";
import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { map, of } from "rxjs";
import { getRelaysFromList } from "../helpers/lists.js";
import {
  BlockedRelaysListEvent,
  DMRelaysListEvent,
  FAVORITE_RELAYS_KIND,
  FavoriteRelaysListEvent,
  isValidBlockedRelaysList,
  isValidDirectMessageRelaysList,
  isValidFavoriteRelaysList,
  isValidSearchRelaysList,
  SearchRelaysListEvent,
} from "../helpers/relay-list.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Base class for relay lists */
class RelayListBase<
  T extends KnownEvent<
    | typeof FAVORITE_RELAYS_KIND
    | typeof kinds.SearchRelaysList
    | kinds.BlockedRelaysList
    | typeof kinds.DirectMessageRelaysList
  >,
> extends EventCast<T> {
  constructor(event: T, store: CastRefEventStore) {
    if (
      event.kind !== FAVORITE_RELAYS_KIND &&
      event.kind !== kinds.SearchRelaysList &&
      event.kind !== kinds.BlockedRelaysList &&
      event.kind !== kinds.DirectMessageRelaysList
    )
      throw new Error(`Invalid relay list (kind ${event.kind})`);
    super(event, store);
  }

  /** The public relays in the relay list */
  get relays() {
    return getRelaysFromList(this.event);
  }

  /** The hidden relays in the relay list */
  get hidden() {
    return getRelaysFromList(this.event, "hidden");
  }
  /** An observable that updates when the hidden relays are unlocked */
  get hidden$() {
    return this.$$ref("hidden$", (store) =>
      of(this.event).pipe(
        // Watch for event updates
        watchEventUpdates(store),
        // Get the hidden relays
        map((event) => event && getRelaysFromList(event, "hidden")),
        // Only emit when the hidden relays are unlocked
        defined(),
      ),
    );
  }
  /** Whether the relay list has hidden relays */
  get hasHidden() {
    return hasHiddenTags(this.event);
  }
  /** Whether the relay list is unlocked */
  get unlocked() {
    return isHiddenTagsUnlocked(this.event);
  }
  /** Unlocks the hidden relays on the relay list */
  async unlock(signer: HiddenContentSigner) {
    await unlockHiddenTags(this.event, signer);
    return this.hidden;
  }
}

/** Class for favorite relays lists (kind 10012) */
export class FavoriteRelays extends RelayListBase<FavoriteRelaysListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidFavoriteRelaysList(event)) throw new Error("Invalid favorite relays list");
    super(event, store);
  }
}

/** Class for search relays lists (kind 10007) */
export class SearchRelays extends RelayListBase<SearchRelaysListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidSearchRelaysList(event)) throw new Error("Invalid search relays list");
    super(event, store);
  }
}

/** Class for blocked relays lists (kind 10006) */
export class BlockedRelays extends RelayListBase<BlockedRelaysListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidBlockedRelaysList(event)) throw new Error("Invalid blocked relays list");
    super(event, store);
  }
}

/** Class for DM relays lists (kind 10050, NIP-17) */
export class DirectMessageRelays extends RelayListBase<DMRelaysListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidDirectMessageRelaysList(event)) throw new Error("Invalid DM relays list");
    super(event, store);
  }
}
