import { RelaySetFactory } from "applesauce-common/factories";
import { getReplaceableIdentifier, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { Action, ActionContext } from "../action-runner.js";

async function modifyRelaySet(
  identifier: string,
  { user }: ActionContext,
): Promise<[RelaySetFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.Relaysets, identifier).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? RelaySetFactory.modify(event) : RelaySetFactory.create(), outboxes];
}

/** An action that adds a relay to a relay set */
export function AddRelayToRelaySet(
  relay: string | string[],
  identifier: NostrEvent | string,
  hidden?: boolean,
): Action {
  const id = typeof identifier === "string" ? identifier : getReplaceableIdentifier(identifier);
  return async (context) => {
    const [factory, outboxes] = await modifyRelaySet(id, context);
    const signed = await factory.addRelay(relay, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a relay from a relay set */
export function RemoveRelayFromRelaySet(
  relay: string | string[],
  identifier: NostrEvent | string,
  hidden?: boolean,
): Action {
  const id = typeof identifier === "string" ? identifier : getReplaceableIdentifier(identifier);
  return async (context) => {
    const [factory, outboxes] = await modifyRelaySet(id, context);
    const signed = await factory.removeRelay(relay, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that creates a new relay set */
export function CreateRelaySet(
  title: string,
  options?: {
    description?: string;
    image?: string;
    public?: string[];
    hidden?: string[];
  },
): Action {
  return async ({ signer, user, publish }) => {
    let factory = RelaySetFactory.create().title(title);
    if (options?.description) factory = factory.description(options.description);
    if (options?.image) factory = factory.image(options.image);
    if (options?.public) factory = factory.addRelay(options.public);
    if (options?.hidden) factory = factory.addRelay(options.hidden, true);
    const signed = await factory.sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}

/** An action that updates the title, description, or image of a relay set */
export function UpdateRelaySetInformation(
  identifier: string,
  info: { title?: string; description?: string; image?: string },
): Action {
  return async ({ user, signer, publish }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Relaysets, identifier).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!event) throw new Error("Relay set not found");

    let factory = RelaySetFactory.modify(event);
    if (info.title) factory = factory.title(info.title);
    if (info.description) factory = factory.description(info.description);
    if (info.image) factory = factory.image(info.image);
    const signed = await factory.sign(signer);

    await publish(signed, outboxes);
  };
}
