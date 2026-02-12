import * as List from "applesauce-common/operations/list";
import { TagOperation } from "applesauce-core";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getReplaceableIdentifier } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { addProfilePointerTag, removeProfilePointerTag } from "applesauce-core/operations/tag/common";
import { Action } from "../action-runner.js";

function ModifyFollowSetEvent(operations: TagOperation[], set: NostrEvent | string, hidden = false): Action {
  const identifier = typeof set === "string" ? set : getReplaceableIdentifier(set);

  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Followsets, identifier).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = hidden ? modifyHiddenTags(factory.services.signer, ...operations) : modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.Followsets }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/**
 * An action that creates a new follow set
 * @throws if a follow set already exists
 */
export function CreateFollowSet(
  title: string,
  options?: {
    description?: string;
    image?: string;
    public?: (string | ProfilePointer)[];
    hidden?: (string | ProfilePointer)[];
  },
): Action {
  return async ({ factory, user, publish }) => {
    const draft = await factory.build(
      { kind: kinds.Followsets },

      // set list information
      List.setTitle(title),
      options?.description ? List.setDescription(options.description) : undefined,
      options?.image ? List.setImage(options.image) : undefined,

      // add pubkey tags
      options?.public ? modifyPublicTags(...options.public.map((p) => addProfilePointerTag(p))) : undefined,
      options?.hidden ? modifyHiddenTags(factory.services.signer, ...options.hidden.map((p) => addProfilePointerTag(p))) : undefined,
    );

    const signed = await factory.sign(draft);
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}

/**
 * An action that adds a pubkey to a follow set
 * @param pubkey the pubkey to add to the set
 * @param identifier the "d" tag of the follow set
 * @param hidden set to true to add to hidden follows
 */
export function AddUserToFollowSet(
  pubkey: (string | ProfilePointer)[] | string | ProfilePointer,
  identifier: NostrEvent | string,
  hidden = false,
): Action {
  return ModifyFollowSetEvent(
    Array.isArray(pubkey) ? pubkey.map((p) => addProfilePointerTag(p)) : [addProfilePointerTag(pubkey)],
    identifier,
    hidden,
  );
}

/**
 * An action that removes a pubkey from a follow set
 * @param pubkey the pubkey to remove from the set
 * @param identifier the "d" tag of the follow set
 * @param hidden set to true to remove from hidden follows
 */
export function RemoveUserFromFollowSet(
  pubkey: (string | ProfilePointer)[] | string | ProfilePointer,
  identifier: NostrEvent | string,
  hidden = false,
): Action {
  return ModifyFollowSetEvent(
    Array.isArray(pubkey) ? pubkey.map((p) => removeProfilePointerTag(p)) : [removeProfilePointerTag(pubkey)],
    identifier,
    hidden,
  );
}

/**
 * An action that updates the title, description, or image of a follow set
 * @param identifier the "d" tag of the follow set
 * @param info the new information for the follow set
 * @throws if the follow set does not exist
 */
export function UpdateFollowSetInformation(
  identifier: string,
  info: {
    title?: string;
    description?: string;
    image?: string;
  },
): Action {
  return async ({ factory, sign, user, publish }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Followsets, identifier).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!event) throw new Error("Follow set not found");

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
