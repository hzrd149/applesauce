import { BlockedRelaysFactory } from "applesauce-common/factories";
import { kinds } from "applesauce-core/helpers/event";
import { Action, ActionContext } from "../action-runner.js";

async function modifyBlockedRelays({ user }: ActionContext): Promise<[BlockedRelaysFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.BlockedRelaysList).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? BlockedRelaysFactory.modify(event) : BlockedRelaysFactory.create(), outboxes];
}

/** An action that adds a relay to the 10006 blocked relays event */
export function AddBlockedRelay(relay: string | string[], hidden = false): Action {
  const relays = Array.isArray(relay) ? relay : [relay];
  return async (context) => {
    const [factory, outboxes] = await modifyBlockedRelays(context);
    const signed = await factory.addRelay(relays, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a relay from the 10006 blocked relays event */
export function RemoveBlockedRelay(relay: string | string[], hidden = false): Action {
  const relays = Array.isArray(relay) ? relay : [relay];
  return async (context) => {
    const [factory, outboxes] = await modifyBlockedRelays(context);
    const signed = await factory.removeRelay(relays, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}
