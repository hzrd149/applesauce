import { EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer, EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import {
  addAddressPointerTag,
  addEventPointerTag,
  addProfilePointerTag,
  removeAddressPointerTag,
  removeEventPointerTag,
  removeProfilePointerTag,
  removeSingletonTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";

/** A factory class for modifying any NIP-51 list event (kind-agnostic) */
export class ListFactory<
  K extends number = number,
  T extends KnownEventTemplate<K> = KnownEventTemplate<K>,
> extends EventFactory<K, T> {
  /** Creates a new list factory from an existing list event */
  static modify(event: NostrEvent): ListFactory {
    return new ListFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets or removes the title of the list */
  title(title: string | null) {
    return title === null
      ? this.modifyPublicTags(removeSingletonTag("title"))
      : this.modifyPublicTags(setSingletonTag(["title", title], true));
  }

  /** Sets or removes the description of the list */
  description(description: string | null) {
    return description === null
      ? this.modifyPublicTags(removeSingletonTag("description"))
      : this.modifyPublicTags(setSingletonTag(["description", description], true));
  }

  /** Sets or removes the image of the list */
  image(image: string | null) {
    return image === null
      ? this.modifyPublicTags(removeSingletonTag("image"))
      : this.modifyPublicTags(setSingletonTag(["image", image], true));
  }
}

/**
 * A base factory class for NIP-51 lists that contain relay URLs.
 * Provides `addRelay` and `removeRelay` methods in addition to `title`, `description`, and `image`.
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

/**
 * A base factory class for NIP-51 lists that contain user pubkeys (profile pointers).
 * Provides `addUser` and `removeUser` methods in addition to `title`, `description`, and `image`.
 */
export class NIP51UserListFactory<
  K extends number = number,
  T extends KnownEventTemplate<K> = KnownEventTemplate<K>,
> extends ListFactory<K, T> {
  /** Adds one or more pubkeys (or ProfilePointers) to the list */
  addUser(pubkey: string | ProfilePointer | (string | ProfilePointer)[], hidden = false) {
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    return hidden
      ? this.modifyHiddenTags(...pubkeys.map((p) => addProfilePointerTag(p)))
      : this.modifyPublicTags(...pubkeys.map((p) => addProfilePointerTag(p)));
  }

  /** Removes one or more pubkeys (or ProfilePointers) from the list */
  removeUser(pubkey: string | ProfilePointer | (string | ProfilePointer)[], hidden = false) {
    const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
    return hidden
      ? this.modifyHiddenTags(...pubkeys.map((p) => removeProfilePointerTag(p)))
      : this.modifyPublicTags(...pubkeys.map((p) => removeProfilePointerTag(p)));
  }
}

/**
 * A base factory class for NIP-51 lists that contain event / address pointers.
 * Provides `addItem` and `removeItem` methods in addition to `title`, `description`, and `image`.
 */
export class NIP51ItemListFactory<
  K extends number = number,
  T extends KnownEventTemplate<K> = KnownEventTemplate<K>,
> extends ListFactory<K, T> {
  /** Adds an event (by id or EventPointer) to the list */
  addEventItem(id: string | EventPointer | NostrEvent, hidden = false) {
    return hidden ? this.modifyHiddenTags(addEventPointerTag(id)) : this.modifyPublicTags(addEventPointerTag(id));
  }

  /** Removes an event (by id or EventPointer) from the list */
  removeEventItem(id: string | EventPointer, hidden = false) {
    return hidden ? this.modifyHiddenTags(removeEventPointerTag(id)) : this.modifyPublicTags(removeEventPointerTag(id));
  }

  /** Adds an addressable event (by AddressPointer or NostrEvent) to the list */
  addAddressItem(address: string | AddressPointer | NostrEvent, hidden = false) {
    return hidden
      ? this.modifyHiddenTags(addAddressPointerTag(address))
      : this.modifyPublicTags(addAddressPointerTag(address));
  }

  /** Removes an addressable event (by AddressPointer or NostrEvent) from the list */
  removeAddressItem(address: string | AddressPointer | NostrEvent, hidden = false) {
    return hidden
      ? this.modifyHiddenTags(removeAddressPointerTag(address))
      : this.modifyPublicTags(removeAddressPointerTag(address));
  }
}
