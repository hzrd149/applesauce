import { DmRelaysFactory } from "applesauce-common/factories";
import { kinds } from "applesauce-core/helpers/event";
import { Action, ActionContext } from "../action-runner.js";

async function modifyDmRelays({ user }: ActionContext): Promise<[DmRelaysFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.DirectMessageRelaysList).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? DmRelaysFactory.modify(event) : DmRelaysFactory.create(), outboxes];
}

/** An action that adds a relay to the 10050 DM relays event */
export function AddDirectMessageRelay(relay: string | string[]): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyDmRelays(context);
    const signed = await factory.addRelay(relay).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a relay from the 10050 DM relays event */
export function RemoveDirectMessageRelay(relay: string | string[]): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyDmRelays(context);
    const signed = await factory.removeRelay(relay).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Creates a new DM relays event */
export function NewDirectMessageRelays(relays?: string[]): Action {
  return async ({ user, signer, publish }) => {
    const existing = await user.replaceable(kinds.DirectMessageRelaysList).$first(1000, undefined);
    if (existing) throw new Error("DM relays event already exists");

    let factory = DmRelaysFactory.create();
    if (relays?.length) factory = factory.addRelay(relays);
    const signed = await factory.sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
