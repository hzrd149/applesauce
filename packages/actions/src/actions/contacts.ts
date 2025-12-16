import { EventTemplate, kinds } from "applesauce-core/helpers/event";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { modifyPublicTags } from "applesauce-core/operations";
import { addProfilePointerTag, removeProfilePointerTag } from "applesauce-core/operations/tag/common";
import { Action } from "../action-hub.js";

/** An action that adds a pubkey to a users contacts event */
export function FollowUser(user: string | ProfilePointer): Action {
  return async function* ({ events, factory, self }) {
    let contacts = events.getReplaceable(kinds.Contacts, self);

    const operation = addProfilePointerTag(user);

    let draft: EventTemplate;

    // No contact list, create one
    if (!contacts) draft = await factory.build({ kind: kinds.Contacts }, modifyPublicTags(operation));
    else draft = await factory.modifyTags(contacts, operation);

    yield await factory.sign(draft);
  };
}

/** An action that removes a pubkey from a users contacts event */
export function UnfollowUser(user: string | ProfilePointer): Action {
  return async function* ({ events, factory, self }) {
    const contacts = events.getReplaceable(kinds.Contacts, self);

    // Unable to find a contacts event, so we can't unfollow
    if (!contacts) return;

    const operation = removeProfilePointerTag(user);
    const draft = await factory.modifyTags(contacts, operation);
    yield await factory.sign(draft);
  };
}

/** An action that creates a new kind 3 contacts lists, throws if a contact list already exists */
export function NewContacts(pubkeys?: (string | ProfilePointer)[]): Action {
  return async function* ({ events, factory, self }) {
    const contacts = events.getReplaceable(kinds.Contacts, self);
    if (contacts) throw new Error("Contact list already exists");

    const draft = await factory.build(
      { kind: kinds.Contacts },
      pubkeys ? modifyPublicTags(...pubkeys.map((p) => addProfilePointerTag(p))) : undefined,
    );
    yield await factory.sign(draft);
  };
}
