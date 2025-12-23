import { FAVORITE_RELAYS_KIND } from "applesauce-common/helpers/relay-list";
import { TagOperation } from "applesauce-core";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { addAddressPointerTag, removeAddressPointerTag } from "applesauce-core/operations/tag/common";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { Action } from "../action-runner.js";

function ModifyFavoriteRelaysEvent(operations: TagOperation[], hidden = false): Action {
  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(FAVORITE_RELAYS_KIND).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    // create the event operation
    const operation = hidden ? modifyHiddenTags(...operations) : modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: FAVORITE_RELAYS_KIND }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a relay to the 10012 favorite relays event */
export function AddFavoriteRelay(relay: string | string[], hidden = false): Action {
  if (typeof relay === "string") relay = [relay];
  return ModifyFavoriteRelaysEvent([...relay.map((r) => addRelayTag(r))], hidden);
}

/** An action that removes a relay from the 10012 favorite relays event */
export function RemoveFavoriteRelay(relay: string | string[], hidden = false): Action {
  if (typeof relay === "string") relay = [relay];
  return ModifyFavoriteRelaysEvent([...relay.map((r) => removeRelayTag(r))], hidden);
}

/** An action that adds a relay set to the 10012 favorite relays event */
export function AddFavoriteRelaySet(addr: AddressPointer[] | AddressPointer, hidden = false): Action {
  if (!Array.isArray(addr)) addr = [addr];
  return ModifyFavoriteRelaysEvent([...addr.map((a) => addAddressPointerTag(a))], hidden);
}

/** An action that removes a relay set from the 10012 favorite relays event */
export function RemoveFavoriteRelaySet(addr: AddressPointer[] | AddressPointer, hidden = false): Action {
  if (!Array.isArray(addr)) addr = [addr];
  return ModifyFavoriteRelaysEvent([...addr.map((a) => removeAddressPointerTag(a))], hidden);
}

/** Creates a new favorite relays event */
export function NewFavoriteRelays(
  relays?: string[] | { public?: string[]; hidden?: string[] },
  sets?: AddressPointer[] | { public?: AddressPointer[]; hidden?: AddressPointer[] },
): Action {
  return async ({ events, factory, self, user, publish, sign }) => {
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
      publicOperations.push(...sets.map((s) => addAddressPointerTag(s)));
    } else {
      if (sets?.public) publicOperations.push(...(sets?.public ?? []).map((s) => addAddressPointerTag(s)));
      if (sets?.hidden) hiddenOperations.push(...(sets?.hidden ?? []).map((s) => addAddressPointerTag(s)));
    }

    const signed = await factory
      .build(
        { kind: FAVORITE_RELAYS_KIND },
        publicOperations.length ? modifyPublicTags(...publicOperations) : undefined,
        hiddenOperations.length ? modifyHiddenTags(...hiddenOperations) : undefined,
      )
      .then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
