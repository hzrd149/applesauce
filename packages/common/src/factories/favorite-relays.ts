import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { addAddressPointerTag, removeAddressPointerTag } from "applesauce-core/operations/tag/common";
import { FAVORITE_RELAYS_KIND } from "../helpers/relay-list.js";
import { NIP51RelayListFactory } from "./list.js";

export type FavoriteRelaysTemplate = KnownEventTemplate<typeof FAVORITE_RELAYS_KIND>;

/** A factory class for building kind 10012 favorite relays list events */
export class FavoriteRelaysFactory extends NIP51RelayListFactory<typeof FAVORITE_RELAYS_KIND, FavoriteRelaysTemplate> {
  /** Creates a new favorite relays factory */
  static create(): FavoriteRelaysFactory {
    return new FavoriteRelaysFactory((res) => res(blankEventTemplate(FAVORITE_RELAYS_KIND) as FavoriteRelaysTemplate));
  }

  /** Creates a new favorite relays factory from an existing favorite relays event */
  static modify(event: NostrEvent | KnownEvent<typeof FAVORITE_RELAYS_KIND>): FavoriteRelaysFactory {
    if (event.kind !== FAVORITE_RELAYS_KIND) throw new Error("Event is not a favorite relays event");
    return new FavoriteRelaysFactory((res) => res(toEventTemplate(event) as FavoriteRelaysTemplate));
  }

  /** Adds a relay set (address pointer) to the favorite relays event */
  addRelaySet(addr: AddressPointer | AddressPointer[], hidden = false) {
    const addrs = Array.isArray(addr) ? addr : [addr];
    return hidden
      ? this.modifyHiddenTags(...addrs.map((a) => addAddressPointerTag(a)))
      : this.modifyPublicTags(...addrs.map((a) => addAddressPointerTag(a)));
  }

  /** Removes a relay set (address pointer) from the favorite relays event */
  removeRelaySet(addr: AddressPointer | AddressPointer[], hidden = false) {
    const addrs = Array.isArray(addr) ? addr : [addr];
    return hidden
      ? this.modifyHiddenTags(...addrs.map((a) => removeAddressPointerTag(a)))
      : this.modifyPublicTags(...addrs.map((a) => removeAddressPointerTag(a)));
  }
}
