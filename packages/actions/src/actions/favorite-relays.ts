import { IEventStoreRead } from "applesauce-core/event-store";
import { FAVORITE_RELAYS_KIND } from "applesauce-core/helpers/lists";
import { TagOperation } from "applesauce-factory";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-factory/operations";
import { addAddressTag, addRelayTag, removeAddressTag, removeRelayTag } from "applesauce-factory/operations/tag";
import { AddressPointer } from "nostr-tools/nip19";

import { Action } from "../action-hub.js";

function getFavoriteRelaysEvent(events: IEventStoreRead, self: string) {
  const event = events.getReplaceable(FAVORITE_RELAYS_KIND, self);
  if (!event) throw new Error("Can't find favorite relays event");
  return event;
}

/** An action that adds a relay to the 10012 favorite relays event */
export function AddFavoriteRelay(relay: string | string[], hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const favorites = getFavoriteRelaysEvent(events, self);

    const operation = Array.isArray(relay) ? relay.map((r) => addRelayTag(r)) : addRelayTag(relay);
    const draft = await factory.modifyTags(favorites, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** An action that removes a relay from the 10012 favorite relays event */
export function RemoveFavoriteRelay(relay: string | string[], hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const favorites = getFavoriteRelaysEvent(events, self);

    const operation = Array.isArray(relay) ? relay.map((r) => removeRelayTag(r)) : removeRelayTag(relay);
    const draft = await factory.modifyTags(favorites, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** An action that adds a relay set to the 10012 favorite relays event */
export function AddFavoriteRelaySet(addr: AddressPointer[] | AddressPointer, hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const favorites = getFavoriteRelaysEvent(events, self);

    const operation = Array.isArray(addr) ? addr.map((a) => addAddressTag(a)) : addAddressTag(addr);
    const draft = await factory.modifyTags(favorites, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** An action that removes a relay set from the 10012 favorite relays event */
export function RemoveFavoriteRelaySet(addr: AddressPointer[] | AddressPointer, hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const favorites = getFavoriteRelaysEvent(events, self);

    const operation = Array.isArray(addr) ? addr.map((a) => removeAddressTag(a)) : removeAddressTag(addr);
    const draft = await factory.modifyTags(favorites, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** Creates a new favorite relays event */
export function NewFavoriteRelays(
  relays?: string[] | { public?: string[]; hidden?: string[] },
  sets?: AddressPointer[] | { public?: AddressPointer[]; hidden?: AddressPointer[] },
): Action {
  return async function* ({ events, factory, self }) {
    const favorites = events.getReplaceable(FAVORITE_RELAYS_KIND, self);
    if (favorites) throw new Error("Favorite relays event already exists");

    let publicOperations: TagOperation[] = [];
    let hiddenOperations: TagOperation[] = [];
    if (Array.isArray(relays)) {
      publicOperations.push(...relays.map((r) => addRelayTag(r)));
    } else {
      if (relays?.public) publicOperations.push(...(relays?.public ?? []).map((r) => addRelayTag(r)));
      if (relays?.hidden) hiddenOperations.push(...(relays?.hidden ?? []).map((r) => addRelayTag(r)));
    }

    if (Array.isArray(sets)) {
      publicOperations.push(...sets.map((s) => addAddressTag(s)));
    } else {
      if (sets?.public) publicOperations.push(...(sets?.public ?? []).map((s) => addAddressTag(s)));
      if (sets?.hidden) hiddenOperations.push(...(sets?.hidden ?? []).map((s) => addAddressTag(s)));
    }

    const draft = await factory.build(
      { kind: FAVORITE_RELAYS_KIND },
      publicOperations.length ? modifyPublicTags(...publicOperations) : undefined,
      hiddenOperations.length ? modifyHiddenTags(...hiddenOperations) : undefined,
    );
    yield await factory.sign(draft);
  };
}
