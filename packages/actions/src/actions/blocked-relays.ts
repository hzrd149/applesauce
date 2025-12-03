import { IEventStoreRead, TagOperation } from "applesauce-core";
import { kinds } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { Action } from "../action-hub.js";

function getBlockedRelaysEvent(events: IEventStoreRead, self: string) {
  const event = events.getReplaceable(kinds.BlockedRelaysList, self);
  if (!event) throw new Error("Can't find blocked relays event");
  return event;
}

/** An action that adds a relay to the 10006 blocked relays event */
export function AddBlockedRelay(relay: string | string[], hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const blocked = getBlockedRelaysEvent(events, self);

    const operation = Array.isArray(relay) ? relay.map((r) => addRelayTag(r)) : addRelayTag(relay);
    const draft = await factory.modifyTags(blocked, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** An action that removes a relay from the 10006 blocked relays event */
export function RemoveBlockedRelay(relay: string | string[], hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const blocked = getBlockedRelaysEvent(events, self);

    const operation = Array.isArray(relay) ? relay.map((r) => removeRelayTag(r)) : removeRelayTag(relay);
    const draft = await factory.modifyTags(blocked, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** Creates a new blocked relays event */
export function NewBlockedRelays(relays?: string[] | { public?: string[]; hidden?: string[] }): Action {
  return async function* ({ events, factory, self }) {
    const blocked = events.getReplaceable(kinds.BlockedRelaysList, self);
    if (blocked) throw new Error("Blocked relays event already exists");

    let publicOperations: TagOperation[] = [];
    let hiddenOperations: TagOperation[] = [];
    if (Array.isArray(relays)) {
      publicOperations.push(...relays.map((r) => addRelayTag(r)));
    } else {
      if (relays?.public) publicOperations.push(...(relays?.public ?? []).map((r) => addRelayTag(r)));
      if (relays?.hidden) hiddenOperations.push(...(relays?.hidden ?? []).map((r) => addRelayTag(r)));
    }

    const draft = await factory.build(
      { kind: kinds.BlockedRelaysList },
      publicOperations.length ? modifyPublicTags(...publicOperations) : undefined,
      hiddenOperations.length ? modifyHiddenTags(...hiddenOperations) : undefined,
    );
    yield await factory.sign(draft);
  };
}
