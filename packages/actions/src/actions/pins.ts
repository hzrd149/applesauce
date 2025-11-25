import { getReplaceableAddress, isReplaceable } from "applesauce-core/helpers/event";
import { modifyPublicTags } from "applesauce-factory/operations";
import { addAddressTag, addEventTag, removeAddressTag, removeEventTag } from "applesauce-factory/operations/tag";
import { kinds, NostrEvent } from "nostr-tools";

import { Action } from "../action-hub.js";

export const ALLOWED_PIN_KINDS = [kinds.ShortTextNote, kinds.LongFormArticle];

/** An action that pins a note to the users pin list */
export function PinNote(note: NostrEvent): Action {
  if (!ALLOWED_PIN_KINDS.includes(note.kind)) throw new Error(`Event kind ${note.kind} can not be pinned`);

  return async function* ({ events, factory, self }) {
    const pins = events.getReplaceable(kinds.Pinlist, self);

    const operation = isReplaceable(note.kind) ? addAddressTag(getReplaceableAddress(note)) : addEventTag(note.id);
    const draft = pins
      ? await factory.modifyTags(pins, operation)
      : await factory.build({ kind: kinds.Pinlist }, modifyPublicTags(operation));

    yield await factory.sign(draft);
  };
}

/** An action that removes an event from the users pin list */
export function UnpinNote(note: NostrEvent): Action {
  return async function* ({ events, factory, self }) {
    const pins = events.getReplaceable(kinds.Pinlist, self);
    if (!pins) return;

    const operation = isReplaceable(note.kind)
      ? removeAddressTag(getReplaceableAddress(note))
      : removeEventTag(note.id);
    const draft = await factory.modifyTags(pins, operation);

    yield await factory.sign(draft);
  };
}

/** An action that creates a new pin list for a user */
export function CreatePinList(pins: NostrEvent[] = []): Action {
  return async function* ({ events, factory, self }) {
    const existing = events.getReplaceable(kinds.Pinlist, self);
    if (existing) throw new Error("Pin list already exists");

    const draft = await factory.build(
      { kind: kinds.Pinlist },
      modifyPublicTags(...pins.map((event) => addEventTag(event.id))),
    );
    yield await factory.sign(draft);
  };
}
