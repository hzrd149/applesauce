import { modifyHiddenTags, modifyPublicTags } from "applesauce-factory/operations";
import { addPubkeyTag, removePubkeyTag } from "applesauce-factory/operations/tag";
import { EventTemplate, kinds } from "nostr-tools";
import { ProfilePointer } from "nostr-tools/nip19";
import { Action } from "../action-hub.js";

/** An action that adds a pubkey to a users contacts event */
export function FollowUser(pubkey: string, relay?: string, hidden = false): Action {
  return async function* ({ events, factory, self }) {
    let contacts = events.getReplaceable(kinds.Contacts, self);

    const pointer = { pubkey, relays: relay ? [relay] : undefined };
    const operation = addPubkeyTag(pointer);

    let draft: EventTemplate;

    // No contact list, create one
    if (!contacts)
      draft = await factory.build(
        { kind: kinds.Contacts },
        hidden ? modifyHiddenTags(operation) : modifyPublicTags(operation),
      );
    else draft = await factory.modifyTags(contacts, hidden ? { hidden: operation } : operation);

    yield await factory.sign(draft);
  };
}

/** An action that removes a pubkey from a users contacts event */
export function UnfollowUser(user: string | ProfilePointer, hidden = false): Action {
  return async function* ({ events, factory, self }) {
    const contacts = events.getReplaceable(kinds.Contacts, self);

    // Unable to find a contacts event, so we can't unfollow
    if (!contacts) return;

    const operation = removePubkeyTag(user);
    const draft = await factory.modifyTags(contacts, hidden ? { hidden: operation } : operation);
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
      pubkeys ? modifyPublicTags(...pubkeys.map((p) => addPubkeyTag(p))) : undefined,
    );
    yield await factory.sign(draft);
  };
}
