import { BLOSSOM_SERVER_LIST_KIND } from "applesauce-common/helpers/blossom";
import { addBlossomServer, removeBlossomServer } from "applesauce-common/operations/blossom";
import { EventOperation } from "applesauce-core/event-factory";
import { Action } from "../action-hub.js";

// Action to modify or create a new Blossom servers event
function ModifyBlossomServersEvent(operations: EventOperation[]): Action {
  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(BLOSSOM_SERVER_LIST_KIND, user.pubkey).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, ...operations).then(sign)
      : await factory.build({ kind: BLOSSOM_SERVER_LIST_KIND }, ...operations).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a server to the Blossom servers event */
export function AddBlossomServer(server: string | URL | (string | URL)[]): Action {
  return ModifyBlossomServersEvent(
    Array.isArray(server) ? server.map((s) => addBlossomServer(s)) : [addBlossomServer(server)],
  );
}

/** An action that removes a server from the Blossom servers event */
export function RemoveBlossomServer(server: string | URL | (string | URL)[]): Action {
  return ModifyBlossomServersEvent(
    Array.isArray(server) ? server.map((s) => removeBlossomServer(s)) : [removeBlossomServer(server)],
  );
}

// Small event operation to prepend a tag to the events tags
function prependTag(tag: string[]): EventOperation {
  return (draft) => ({ ...draft, tags: [tag, ...draft.tags] });
}

/** Makes a specific Blossom server the default server (move it to the top of the list) */
export function SetDefaultBlossomServer(server: string | URL): Action {
  return ModifyBlossomServersEvent([removeBlossomServer(server), prependTag(["server", String(server)])]);
}

/** Creates a new Blossom servers event */
export function NewBlossomServers(servers?: (string | URL)[]): Action {
  return async ({ events, factory, self, user, publish, sign }) => {
    const existing = events.getReplaceable(BLOSSOM_SERVER_LIST_KIND, self);
    if (existing) throw new Error("Blossom servers event already exists");

    const operations: EventOperation[] = servers ? servers.map((s) => addBlossomServer(s)) : [];

    const signed = await factory.build({ kind: BLOSSOM_SERVER_LIST_KIND }, ...operations).then(sign);
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
