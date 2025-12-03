import { IEventStoreRead } from "applesauce-core/event-store";
import { TagOperation } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";

import { Action } from "../action-hub.js";

function getSearchRelaysEvent(events: IEventStoreRead, self: string) {
  const event = events.getReplaceable(kinds.SearchRelaysList, self);
  if (!event) throw new Error("Can't find search relays event");
  return event;
}

/** An action that adds a relay to the 10007 search relays event */
export function AddSearchRelay(relay: string | string[], hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const search = getSearchRelaysEvent(events, self);

    const operation = Array.isArray(relay) ? relay.map((r) => addRelayTag(r)) : addRelayTag(relay);
    const draft = await factory.modifyTags(search, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** An action that removes a relay from the 10007 search relays event */
export function RemoveSearchRelay(relay: string | string[], hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const search = getSearchRelaysEvent(events, self);

    const operation = Array.isArray(relay) ? relay.map((r) => removeRelayTag(r)) : removeRelayTag(relay);
    const draft = await factory.modifyTags(search, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** Creates a new search relays event */
export function NewSearchRelays(relays?: string[] | { public?: string[]; hidden?: string[] }): Action {
  return async function* ({ events, factory, self }) {
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
    yield await factory.sign(draft);
  };
}
