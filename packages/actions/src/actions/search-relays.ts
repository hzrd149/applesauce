import { SearchRelaysFactory } from "applesauce-common/factories";
import { kinds } from "applesauce-core/helpers/event";
import { Action, ActionContext } from "../action-runner.js";

async function modifySearchRelays({ user }: ActionContext): Promise<[SearchRelaysFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.SearchRelaysList).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? SearchRelaysFactory.modify(event) : SearchRelaysFactory.create(), outboxes];
}

/** An action that adds a relay to the 10007 search relays event */
export function AddSearchRelay(relay: string | string[], hidden = false): Action {
  return async (context) => {
    const [factory, outboxes] = await modifySearchRelays(context);
    const signed = await factory.addRelay(relay, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a relay from the 10007 search relays event */
export function RemoveSearchRelay(relay: string | string[], hidden = false): Action {
  return async (context) => {
    const [factory, outboxes] = await modifySearchRelays(context);
    const signed = await factory.removeRelay(relay, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Creates a new search relays event */
export function NewSearchRelays(relays?: string[] | { public?: string[]; hidden?: string[] }): Action {
  return async ({ user, signer, publish }) => {
    const existing = await user.replaceable(kinds.SearchRelaysList).$first(1000, undefined);
    if (existing) throw new Error("Search relays event already exists");

    let factory = SearchRelaysFactory.create();
    if (Array.isArray(relays)) {
      factory = factory.addRelay(relays);
    } else {
      if (relays?.public) factory = factory.addRelay(relays.public);
      if (relays?.hidden) factory = factory.addRelay(relays.hidden, true);
    }
    const signed = await factory.sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
