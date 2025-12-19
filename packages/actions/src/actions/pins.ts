import { TagOperation } from "applesauce-core";
import { isReplaceable, kinds, NostrEvent } from "applesauce-core/helpers/event";
import {
  addAddressPointerTag,
  addEventPointerTag,
  removeAddressPointerTag,
  removeEventPointerTag,
} from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { Action } from "../action-hub.js";

function ModifyPinListEvent(operations: TagOperation[]): Action {
  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Pinlist).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    // Create the event operation
    const operation = modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.Pinlist }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

export const ALLOWED_PIN_KINDS = [kinds.ShortTextNote, kinds.LongFormArticle];

/** An action that pins a note to the users pin list */
export function PinNote(note: NostrEvent): Action {
  if (!ALLOWED_PIN_KINDS.includes(note.kind)) throw new Error(`Event kind ${note.kind} can not be pinned`);
  return ModifyPinListEvent([isReplaceable(note.kind) ? addAddressPointerTag(note) : addEventPointerTag(note.id)]);
}

/** An action that removes an event from the users pin list */
export function UnpinNote(note: NostrEvent): Action {
  return ModifyPinListEvent([
    isReplaceable(note.kind) ? removeAddressPointerTag(note) : removeEventPointerTag(note.id),
  ]);
}
