import { MuteListFactory } from "applesauce-common/factories";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { Action, ActionContext } from "../action-runner.js";

async function modifyMuteList({ user }: ActionContext): Promise<[MuteListFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.Mutelist).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? MuteListFactory.modify(event) : MuteListFactory.create(), outboxes];
}

/** An action that adds a pubkey to the mute list */
export function MuteUser(pubkey: string, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.addUser(pubkey, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Removes a pubkey from the mute list */
export function UnmuteUser(pubkey: string, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.removeUser(pubkey, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Add a thread to the mute list */
export function MuteThread(thread: string | NostrEvent | EventPointer, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.muteThread(thread, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Removes a thread from the mute list */
export function UnmuteThread(thread: string | NostrEvent | EventPointer, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.unmuteThread(thread, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Add a word to the mute list */
export function MuteWord(word: string, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.muteWord(word, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Removes a word from the mute list */
export function UnmuteWord(word: string, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.unmuteWord(word, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Add a hashtag to the mute list */
export function MuteHashtag(hashtag: string, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.muteHashtag(hashtag, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** Removes a hashtag from the mute list */
export function UnmuteHashtag(hashtag: string, hidden?: boolean): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyMuteList(context);
    const signed = await factory.unmuteHashtag(hashtag, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}
