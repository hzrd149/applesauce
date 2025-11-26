import { BLOSSOM_SERVER_LIST_KIND } from "applesauce-common/helpers/blossom";
import { addBlossomServer, removeBlossomServer } from "applesauce-common/operations/blossom";
import { EventOperation } from "applesauce-core/event-factory";

import { Action } from "../action-hub.js";

/** An action that adds a server to the Blossom servers event */
export function AddBlossomServer(server: string | URL | (string | URL)[]): Action {
  return async function* ({ events, factory, self }) {
    const servers = events.getReplaceable(BLOSSOM_SERVER_LIST_KIND, self);

    const operations = Array.isArray(server) ? server.map((s) => addBlossomServer(s)) : [addBlossomServer(server)];

    // Modify or build new event
    const draft = servers
      ? await factory.modify(servers, ...operations)
      : await factory.build({ kind: BLOSSOM_SERVER_LIST_KIND }, ...operations);

    yield await factory.sign(draft);
  };
}

/** An action that removes a server from the Blossom servers event */
export function RemoveBlossomServer(server: string | URL | (string | URL)[]): Action {
  return async function* ({ events, factory, self }) {
    const servers = events.getReplaceable(BLOSSOM_SERVER_LIST_KIND, self);

    const operations = Array.isArray(server)
      ? server.map((s) => removeBlossomServer(s))
      : [removeBlossomServer(server)];

    // Modify or build new event
    const draft = servers
      ? await factory.modify(servers, ...operations)
      : await factory.build({ kind: BLOSSOM_SERVER_LIST_KIND }, ...operations);

    yield await factory.sign(draft);
  };
}

/** Makes a specific Blossom server the default server (move it to the top of the list) */
export function SetDefaultBlossomServer(server: string | URL): Action {
  return async function* ({ events, factory, self }) {
    const servers = events.getReplaceable(BLOSSOM_SERVER_LIST_KIND, self);

    const prependTag =
      (tag: string[]): EventOperation =>
      (draft) => ({ ...draft, tags: [tag, ...draft.tags] });
    const operations = [removeBlossomServer(server), prependTag(["server", String(server)])];

    const draft = servers
      ? await factory.modify(servers, ...operations)
      : await factory.build({ kind: BLOSSOM_SERVER_LIST_KIND }, ...operations);

    yield await factory.sign(draft);
  };
}

/** Creates a new Blossom servers event */
export function NewBlossomServers(servers?: (string | URL)[]): Action {
  return async function* ({ events, factory, self }) {
    const existing = events.getReplaceable(BLOSSOM_SERVER_LIST_KIND, self);
    if (existing) throw new Error("Blossom servers event already exists");

    const operations: EventOperation[] = servers ? servers.map((s) => addBlossomServer(s)) : [];

    const draft = await factory.build({ kind: BLOSSOM_SERVER_LIST_KIND }, ...operations);
    yield await factory.sign(draft);
  };
}
