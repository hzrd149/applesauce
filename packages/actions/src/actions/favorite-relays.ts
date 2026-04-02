import { FavoriteRelaysFactory } from "applesauce-common/factories";
import { FAVORITE_RELAYS_KIND } from "applesauce-common/helpers/relay-list";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { Action, ActionContext } from "../action-runner.js";

async function modifyFavoriteRelays({ user }: ActionContext): Promise<[FavoriteRelaysFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(FAVORITE_RELAYS_KIND).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? FavoriteRelaysFactory.modify(event) : FavoriteRelaysFactory.create(), outboxes];
}

/** An action that adds a relay to the 10012 favorite relays event */
export function AddFavoriteRelay(relay: string | string[], hidden = false): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyFavoriteRelays(context);
    const signed = await factory.addRelay(relay, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a relay from the 10012 favorite relays event */
export function RemoveFavoriteRelay(relay: string | string[], hidden = false): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyFavoriteRelays(context);
    const signed = await factory.removeRelay(relay, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that adds a relay set to the 10012 favorite relays event */
export function AddFavoriteRelaySet(addr: AddressPointer[] | AddressPointer, hidden = false): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyFavoriteRelays(context);
    const signed = await factory.addRelaySet(addr, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a relay set from the 10012 favorite relays event */
export function RemoveFavoriteRelaySet(addr: AddressPointer[] | AddressPointer, hidden = false): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyFavoriteRelays(context);
    const signed = await factory.removeRelaySet(addr, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Creates a new favorite relays event */
export function NewFavoriteRelays(
  relays?: string[] | { public?: string[]; hidden?: string[] },
  sets?: AddressPointer[] | { public?: AddressPointer[]; hidden?: AddressPointer[] },
): Action {
  return async ({ user, signer, publish }) => {
    const existing = await user.replaceable(FAVORITE_RELAYS_KIND).$first(1000, undefined);
    if (existing) throw new Error("Favorite relays event already exists");

    let factory = FavoriteRelaysFactory.create();

    if (Array.isArray(relays)) {
      factory = factory.addRelay(relays);
    } else {
      if (relays?.public) factory = factory.addRelay(relays.public);
      if (relays?.hidden) factory = factory.addRelay(relays.hidden, true);
    }

    if (Array.isArray(sets)) {
      factory = factory.addRelaySet(sets);
    } else {
      if (sets?.public) factory = factory.addRelaySet(sets.public);
      if (sets?.hidden) factory = factory.addRelaySet(sets.hidden, true);
    }

    const signed = await factory.sign(signer);
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
