import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { addAddressPointerTag, removeAddressPointerTag } from "applesauce-core/operations/tag/common";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { FAVORITE_RELAYS_KIND, LOOKUP_RELAY_LIST_KIND } from "../helpers/relay-list.js";
import { ListFactory } from "./list.js";

/**
 * A base factory class for NIP-51 lists that contain relay URLs (`relay` tags).
 * Provides `addRelay` and `removeRelay` in addition to `title`, `description`, and `image`.
 */
export class NIP51RelayListFactory<
  K extends number = number,
  T extends KnownEventTemplate<K> = KnownEventTemplate<K>,
> extends ListFactory<K, T> {
  /** Adds a relay URL to the list's public tags */
  addRelay(relay: string | string[], hidden = false) {
    const relays = Array.isArray(relay) ? relay : [relay];
    return hidden
      ? this.modifyHiddenTags(...relays.map((r) => addRelayTag(r)))
      : this.modifyPublicTags(...relays.map((r) => addRelayTag(r)));
  }

  /** Removes a relay URL from the list */
  removeRelay(relay: string | string[], hidden = false) {
    const relays = Array.isArray(relay) ? relay : [relay];
    return hidden
      ? this.modifyHiddenTags(...relays.map((r) => removeRelayTag(r)))
      : this.modifyPublicTags(...relays.map((r) => removeRelayTag(r)));
  }
}

export type BlockedRelaysTemplate = KnownEventTemplate<kinds.BlockedRelaysList>;

/** A factory class for building kind 10006 blocked relays list events */
export class BlockedRelaysFactory extends NIP51RelayListFactory<kinds.BlockedRelaysList, BlockedRelaysTemplate> {
  static create(): BlockedRelaysFactory {
    return new BlockedRelaysFactory((res) => res(blankEventTemplate(kinds.BlockedRelaysList)));
  }

  static modify(event: NostrEvent | KnownEvent<kinds.BlockedRelaysList>): BlockedRelaysFactory {
    if (!isKind(event, kinds.BlockedRelaysList)) throw new Error("Event is not a blocked relays event");
    return new BlockedRelaysFactory((res) => res(toEventTemplate(event)));
  }
}

export type DmRelaysTemplate = KnownEventTemplate<kinds.DirectMessageRelaysList>;

/** A factory class for building kind 10050 direct message relays list events */
export class DmRelaysFactory extends NIP51RelayListFactory<kinds.DirectMessageRelaysList, DmRelaysTemplate> {
  static create(): DmRelaysFactory {
    return new DmRelaysFactory((res) => res(blankEventTemplate(kinds.DirectMessageRelaysList)));
  }

  static modify(event: NostrEvent | KnownEvent<kinds.DirectMessageRelaysList>): DmRelaysFactory {
    if (!isKind(event, kinds.DirectMessageRelaysList)) throw new Error("Event is not a DM relays event");
    return new DmRelaysFactory((res) => res(toEventTemplate(event)));
  }
}

export type FavoriteRelaysTemplate = KnownEventTemplate<typeof FAVORITE_RELAYS_KIND>;

/** A factory class for building kind 10012 favorite relays list events */
export class FavoriteRelaysFactory extends NIP51RelayListFactory<typeof FAVORITE_RELAYS_KIND, FavoriteRelaysTemplate> {
  static create(): FavoriteRelaysFactory {
    return new FavoriteRelaysFactory((res) => res(blankEventTemplate(FAVORITE_RELAYS_KIND) as FavoriteRelaysTemplate));
  }

  static modify(event: NostrEvent | KnownEvent<typeof FAVORITE_RELAYS_KIND>): FavoriteRelaysFactory {
    if (event.kind !== FAVORITE_RELAYS_KIND) throw new Error("Event is not a favorite relays event");
    return new FavoriteRelaysFactory((res) => res(toEventTemplate(event) as FavoriteRelaysTemplate));
  }

  addRelaySet(addr: AddressPointer | AddressPointer[], hidden = false) {
    const addrs = Array.isArray(addr) ? addr : [addr];
    return hidden
      ? this.modifyHiddenTags(...addrs.map((a) => addAddressPointerTag(a)))
      : this.modifyPublicTags(...addrs.map((a) => addAddressPointerTag(a)));
  }

  removeRelaySet(addr: AddressPointer | AddressPointer[], hidden = false) {
    const addrs = Array.isArray(addr) ? addr : [addr];
    return hidden
      ? this.modifyHiddenTags(...addrs.map((a) => removeAddressPointerTag(a)))
      : this.modifyPublicTags(...addrs.map((a) => removeAddressPointerTag(a)));
  }
}

export type LookupRelayListTemplate = KnownEventTemplate<typeof LOOKUP_RELAY_LIST_KIND>;

/** A factory class for building kind 10086 lookup / indexer relays list events */
export class LookupRelayListFactory extends NIP51RelayListFactory<
  typeof LOOKUP_RELAY_LIST_KIND,
  LookupRelayListTemplate
> {
  static create(): LookupRelayListFactory {
    return new LookupRelayListFactory((res) =>
      res(blankEventTemplate(LOOKUP_RELAY_LIST_KIND) as LookupRelayListTemplate),
    );
  }

  static modify(event: NostrEvent | KnownEvent<typeof LOOKUP_RELAY_LIST_KIND>): LookupRelayListFactory {
    if (event.kind !== LOOKUP_RELAY_LIST_KIND) throw new Error("Event is not a lookup relay list event");
    return new LookupRelayListFactory((res) => res(toEventTemplate(event) as LookupRelayListTemplate));
  }
}

export type SearchRelaysTemplate = KnownEventTemplate<kinds.SearchRelaysList>;

/** A factory class for building kind 10007 search relays list events */
export class SearchRelaysFactory extends NIP51RelayListFactory<kinds.SearchRelaysList, SearchRelaysTemplate> {
  static create(): SearchRelaysFactory {
    return new SearchRelaysFactory((res) => res(blankEventTemplate(kinds.SearchRelaysList)));
  }

  static modify(event: NostrEvent | KnownEvent<kinds.SearchRelaysList>): SearchRelaysFactory {
    if (!isKind(event, kinds.SearchRelaysList)) throw new Error("Event is not a search relays event");
    return new SearchRelaysFactory((res) => res(toEventTemplate(event)));
  }
}
