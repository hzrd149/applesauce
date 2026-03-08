import { BlossomServerListFactory } from "applesauce-common/factories";
import { BLOSSOM_SERVER_LIST_KIND } from "applesauce-common/helpers/blossom";
import type { Action, ActionContext } from "../action-runner.js";

async function modifyBlossomServers({
  user,
}: ActionContext): Promise<[BlossomServerListFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(BLOSSOM_SERVER_LIST_KIND).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? BlossomServerListFactory.modify(event) : BlossomServerListFactory.create(), outboxes];
}

/** An action that adds a server to the Blossom servers event */
export function AddBlossomServer(server: string | URL | (string | URL)[]): Action {
  const servers = Array.isArray(server) ? server : [server];
  return async (context) => {
    const [factory, outboxes] = await modifyBlossomServers(context);
    const signed = await servers.reduce((f, s) => f.addServer(s), factory).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a server from the Blossom servers event */
export function RemoveBlossomServer(server: string | URL | (string | URL)[]): Action {
  const servers = Array.isArray(server) ? server : [server];
  return async (context) => {
    const [factory, outboxes] = await modifyBlossomServers(context);
    const signed = await servers.reduce((f, s) => f.removeServer(s), factory).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Makes a specific Blossom server the default server (moves it to the top of the list) */
export function SetDefaultBlossomServer(server: string | URL): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyBlossomServers(context);
    const signed = await factory.setDefaultServer(server).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Creates a new Blossom servers event */
export function NewBlossomServers(servers?: (string | URL)[]): Action {
  return async ({ events, signer, self, user, publish }) => {
    const existing = events.getReplaceable(BLOSSOM_SERVER_LIST_KIND, self);
    if (existing) throw new Error("Blossom servers event already exists");

    let factory = BlossomServerListFactory.create();
    if (servers?.length) factory = servers.reduce((f, s) => f.addServer(s), factory);
    const signed = await factory.sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
