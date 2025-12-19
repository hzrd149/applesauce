import { TagOperation } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import {
  addEventPointerTag,
  addNameValueTag,
  addProfilePointerTag,
  removeEventPointerTag,
  removeNameValueTag,
  removeProfilePointerTag,
} from "applesauce-core/operations/tag/common";
import { Action } from "../action-hub.js";

function ModifyMuteEvent(operations: TagOperation[], hidden = false): Action {
  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Mutelist).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    // Create the event operation
    const operation = hidden ? modifyHiddenTags(...operations) : modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.Mutelist }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a pubkey to the mute list */
export function MuteUser(pubkey: string, hidden?: boolean): Action {
  return ModifyMuteEvent([addProfilePointerTag(pubkey)], hidden);
}

/** Removes a pubkey from the mute list */
export function UnmuteUser(pubkey: string, hidden?: boolean): Action {
  return ModifyMuteEvent([removeProfilePointerTag(pubkey)], hidden);
}

/** Add a thread to the mute list */
export function MuteThread(thread: string | NostrEvent | EventPointer, hidden?: boolean): Action {
  return ModifyMuteEvent([addEventPointerTag(thread)], hidden);
}

/** Removes a thread from the mute list */
export function UnmuteThread(thread: string | NostrEvent | EventPointer, hidden?: boolean): Action {
  return ModifyMuteEvent([removeEventPointerTag(thread)], hidden);
}

/** Add a word to the mute list */
export function MuteWord(word: string, hidden?: boolean): Action {
  return ModifyMuteEvent([addNameValueTag(["word", word.toLocaleLowerCase()], true)], hidden);
}

/** Removes a word from the mute list */
export function UnmuteWord(word: string, hidden?: boolean): Action {
  return ModifyMuteEvent([removeNameValueTag(["word", word.toLocaleLowerCase()])], hidden);
}

/** Add a hashtag to the mute list */
export function MuteHashtag(hashtag: string, hidden?: boolean): Action {
  return ModifyMuteEvent([addNameValueTag(["t", hashtag.toLocaleLowerCase()], true)], hidden);
}

/** Removes a hashtag from the mute list */
export function UnmuteHashtag(hashtag: string, hidden?: boolean): Action {
  return ModifyMuteEvent([removeNameValueTag(["t", hashtag.toLocaleLowerCase()])], hidden);
}
