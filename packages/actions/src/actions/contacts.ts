import { TagOperation } from "applesauce-core";
import { kinds } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { modifyPublicTags } from "applesauce-core/operations";
import { addProfilePointerTag, removeProfilePointerTag } from "applesauce-core/operations/tag/common";
import { firstValueFrom, of, timeout } from "rxjs";
import { Action } from "../action-runner.js";

function ModifyContactsEvent(operations: TagOperation[]): Action {
  return async ({ events, factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events.replaceable(kinds.Contacts, user.pubkey).pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.Contacts }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a pubkey to a users contacts event */
export function FollowUser(user: string | ProfilePointer): Action {
  return ModifyContactsEvent([addProfilePointerTag(user)]);
}

/** An action that removes a pubkey from a users contacts event */
export function UnfollowUser(user: string | ProfilePointer): Action {
  return ModifyContactsEvent([removeProfilePointerTag(user)]);
}

/** An action that creates a new kind 3 contacts lists, throws if a contact list already exists */
export function NewContacts(pubkeys?: (string | ProfilePointer)[]): Action {
  return async ({ events, factory, self, user, publish, sign }) => {
    const contacts = events.getReplaceable(kinds.Contacts, self);
    if (contacts) throw new Error("Contact list already exists");

    const signed = await factory
      .build(
        { kind: kinds.Contacts },
        pubkeys ? modifyPublicTags(...pubkeys.map((p) => addProfilePointerTag(p))) : undefined,
      )
      .then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
