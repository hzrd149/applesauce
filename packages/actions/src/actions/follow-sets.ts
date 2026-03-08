import { FollowSetFactory } from "applesauce-common/factories";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { getReplaceableIdentifier } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { Action, ActionContext } from "../action-runner.js";

async function modifyFollowSet(
  identifier: string,
  { user }: ActionContext,
): Promise<[FollowSetFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.Followsets, identifier).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? FollowSetFactory.modify(event) : FollowSetFactory.create(), outboxes];
}

/** An action that creates a new follow set */
export function CreateFollowSet(
  title: string,
  options?: {
    description?: string;
    image?: string;
    public?: (string | ProfilePointer)[];
    hidden?: (string | ProfilePointer)[];
  },
): Action {
  return async ({ signer, user, publish }) => {
    let factory = FollowSetFactory.create().title(title);
    if (options?.description) factory = factory.description(options.description);
    if (options?.image) factory = factory.image(options.image);
    if (options?.public) factory = factory.addUser(options.public);
    if (options?.hidden) factory = factory.addUser(options.hidden, true);
    const signed = await factory.sign(signer);

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
  const id = typeof identifier === "string" ? identifier : getReplaceableIdentifier(identifier);
  const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
  return async (context) => {
    const [factory, outboxes] = await modifyFollowSet(id, context);
    const signed = await factory.addUser(pubkeys, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
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
  const id = typeof identifier === "string" ? identifier : getReplaceableIdentifier(identifier);
  const pubkeys = Array.isArray(pubkey) ? pubkey : [pubkey];
  return async (context) => {
    const [factory, outboxes] = await modifyFollowSet(id, context);
    const signed = await factory.removeUser(pubkeys, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/**
 * An action that updates the title, description, or image of a follow set
 * @param identifier the "d" tag of the follow set
 * @param info the new information for the follow set
 * @throws if the follow set does not exist
 */
export function UpdateFollowSetInformation(
  identifier: string,
  info: { title?: string; description?: string; image?: string },
): Action {
  return async ({ user, signer, publish }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Followsets, identifier).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    if (!event) throw new Error("Follow set not found");

    let factory = FollowSetFactory.modify(event);
    if (info.title) factory = factory.title(info.title);
    if (info.description) factory = factory.description(info.description);
    if (info.image) factory = factory.image(info.image);
    const signed = await factory.sign(signer);

    await publish(signed, outboxes);
  };
}
