import { ContactsFactory } from "applesauce-common/factories";
import { kinds } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { Action, ActionContext } from "../action-runner.js";

async function modifyContacts({ user }: ActionContext): Promise<[ContactsFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.Contacts).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? ContactsFactory.modify(event) : ContactsFactory.create(), outboxes];
}

/** An action that adds a pubkey to a users contacts event */
export function FollowUser(pointer: string | ProfilePointer): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyContacts(context);
    const signed = await factory.addContact(pointer).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes a pubkey from a users contacts event */
export function UnfollowUser(pointer: string | ProfilePointer): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyContacts(context);
    const signed = await factory.removeContact(pointer).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that creates a new kind 3 contacts list, throws if a contact list already exists */
export function NewContacts(pubkeys?: (string | ProfilePointer)[]): Action {
  return async ({ user, signer, publish }) => {
    const existing = await user.replaceable(kinds.Contacts).$first(1000, undefined);
    if (existing) throw new Error("Contact list already exists");

    let factory = ContactsFactory.create();
    if (pubkeys?.length) factory = pubkeys.reduce((f, p) => f.addContact(p), factory);
    const signed = await factory.sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
