import { TagOperation } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { Action } from "../action-hub.js";

function ModifySearchRelaysEvent(operations: TagOperation[], hidden = false): Action {
  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.SearchRelaysList).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = hidden ? modifyHiddenTags(...operations) : modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.SearchRelaysList }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a relay to the 10007 search relays event */
export function AddSearchRelay(relay: string | string[], hidden = false): Action {
  return ModifySearchRelaysEvent(
    Array.isArray(relay) ? relay.map((r) => addRelayTag(r)) : [addRelayTag(relay)],
    hidden,
  );
}

/** An action that removes a relay from the 10007 search relays event */
export function RemoveSearchRelay(relay: string | string[], hidden = false): Action {
  return ModifySearchRelaysEvent(
    Array.isArray(relay) ? relay.map((r) => removeRelayTag(r)) : [removeRelayTag(relay)],
    hidden,
  );
}

/** Creates a new search relays event */
export function NewSearchRelays(relays?: string[] | { public?: string[]; hidden?: string[] }): Action {
  return async ({ events, factory, self, user, publish }) => {
    const search = events.getReplaceable(kinds.SearchRelaysList, self);
    if (search) throw new Error("Search relays event already exists");

    let publicOperations: TagOperation[] = [];
    let hiddenOperations: TagOperation[] = [];
    if (Array.isArray(relays)) {
      publicOperations.push(...relays.map((r) => addRelayTag(r)));
    } else {
      if (relays?.public) publicOperations.push(...(relays?.public ?? []).map((r) => addRelayTag(r)));
      if (relays?.hidden) hiddenOperations.push(...(relays?.hidden ?? []).map((r) => addRelayTag(r)));
    }

    const draft = await factory.build(
      { kind: kinds.SearchRelaysList },
      publicOperations.length ? modifyPublicTags(...publicOperations) : undefined,
      hiddenOperations.length ? modifyHiddenTags(...hiddenOperations) : undefined,
    );
    const signed = await factory.sign(draft);
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
