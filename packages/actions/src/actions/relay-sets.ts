import * as List from "applesauce-common/operations/list";
import { TagOperation } from "applesauce-core";
import { getReplaceableIdentifier, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { Action } from "../action-runner.js";

function ModifyRelaySetEvent(operations: TagOperation[], set: NostrEvent | string, hidden = false): Action {
  const identifier = typeof set === "string" ? set : getReplaceableIdentifier(set);

  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Relaysets, identifier).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = hidden ? modifyHiddenTags(factory.services.signer, ...operations) : modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.Relaysets }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a relay to a relay set*/
export function AddRelayToRelaySet(
  relay: string | string[],
  identifier: NostrEvent | string,
  hidden?: boolean,
): Action {
  return ModifyRelaySetEvent(
    Array.isArray(relay) ? relay.map((r) => addRelayTag(r)) : [addRelayTag(relay)],
    identifier,
    hidden,
  );
}

/** An action that removes a relay from a relay set */
export function RemoveRelayFromRelaySet(
  relay: string | string[],
  identifier: NostrEvent | string,
  hidden?: boolean,
): Action {
  return ModifyRelaySetEvent(
    Array.isArray(relay) ? relay.map((r) => removeRelayTag(r)) : [removeRelayTag(relay)],
    identifier,
    hidden,
  );
}

/** An action that creates a new relay set */
export function CreateRelaySet(
  title: string,
  options?: {
    description?: string;
    image?: string;
    public?: string[]; // relay URLs
    hidden?: string[]; // relay URLs
  },
): Action {
  return async ({ factory, user, publish, sign }) => {
    const signed = await factory
      .build(
        { kind: kinds.Relaysets },

        List.setTitle(title),
        options?.description ? List.setDescription(options.description) : undefined,
        options?.image ? List.setImage(options.image) : undefined,

        options?.public ? modifyPublicTags(...options.public.map((r) => addRelayTag(r))) : undefined,
        options?.hidden ? modifyHiddenTags(factory.services.signer, ...options.hidden.map((r) => addRelayTag(r))) : undefined,
      )
      .then(sign);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}

/** An action that updates the title, description, or image of a relay set */
export function UpdateRelaySetInformation(
  identifier: string,
  info: {
    title?: string;
    description?: string;
    image?: string;
  },
): Action {
  return async ({ factory, sign, user, publish }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Relaysets, identifier).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!event) throw new Error("Relay set not found");

    const signed = await factory
      .modify(
        event,

        info?.title ? List.setTitle(info.title) : undefined,
        info?.description ? List.setDescription(info.description) : undefined,
        info?.image ? List.setImage(info.image) : undefined,
      )
      .then(sign);

    await publish(signed, outboxes);
  };
}
