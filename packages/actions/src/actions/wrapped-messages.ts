import { getConversationParticipants } from "applesauce-common/helpers/messages";
import { Rumor } from "applesauce-common/helpers/gift-wrap";
import {
  GiftWrapBlueprint,
  WrappedMessageBlueprint,
  WrappedMessageBlueprintOptions,
  WrappedMessageReplyBlueprint,
} from "applesauce-common/blueprints";
import { GiftWrapOptions } from "applesauce-common/operations/gift-wrap";

import { Action } from "../action-hub.js";

/**
 * Sends a NIP-17 wrapped message to a conversation
 * @param participants - A conversation identifier, user pubkey, or a list of participant pubkeys
 * @param message - The message to send
 * @param opts - Options for the wrapped message and gift wrap
 * @returns Signed gift wrapped messages to send
 */
export function SendWrappedMessage(
  participants: string | string[],
  message: string,
  opts?: WrappedMessageBlueprintOptions & GiftWrapOptions,
): Action {
  return async function* ({ factory, self }) {
    const rumor = await factory.create(WrappedMessageBlueprint, participants, message, opts);

    // Get the pubkeys to send this message to and ensure the sender is included
    const pubkeys = new Set(getConversationParticipants(rumor));
    pubkeys.add(self);

    for (const pubkey of pubkeys) {
      yield await factory.create(GiftWrapBlueprint, pubkey, rumor, opts);
    }
  };
}

/**
 * Sends a NIP-17 reply to a wrapped message
 * @param parent - The parent wrapped message
 * @param message - The message to send
 * @param opts - Options for the wrapped message and gift wrap
 * @returns Signed gift wrapped messages to send
 */
export function ReplyToWrappedMessage(
  parent: Rumor,
  message: string,
  opts?: WrappedMessageBlueprintOptions & GiftWrapOptions,
): Action {
  return async function* ({ factory }) {
    // Create the reply message
    const rumor = await factory.create(WrappedMessageReplyBlueprint, parent, message, opts);

    // Get the pubkeys to send this message to (will include the sender)
    const pubkeys = getConversationParticipants(parent);
    for (const pubkey of pubkeys) {
      yield await factory.create(GiftWrapBlueprint, pubkey, rumor, opts);
    }
  };
}
