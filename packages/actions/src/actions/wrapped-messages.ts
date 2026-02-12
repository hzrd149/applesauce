import {
  GiftWrapBlueprint,
  WrappedMessageBlueprint,
  WrappedMessageBlueprintOptions,
  WrappedMessageReplyBlueprint,
} from "applesauce-common/factories";
import { castUser } from "applesauce-common/casts";
import { Rumor } from "applesauce-common/helpers/gift-wrap";
import { getConversationParticipants } from "applesauce-common/helpers/messages";
import { GiftWrapOptions } from "applesauce-common/operations/gift-wrap";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Action } from "../action-runner.js";

/** Gift wraps a message to a list of participants and publishes it to their inbox relays */
export function GiftWrapMessageToParticipants(message: Rumor, opts?: GiftWrapOptions): Action {
  return async ({ factory, user, publish, events }) => {
    // Get the pubkeys to send this message to and ensure the sender is included
    const receivers = new Set(getConversationParticipants(message));
    receivers.add(user.pubkey);

    // Get all the users inbox relays
    const inboxRelays = new Map<string, string[] | undefined>();
    await Promise.allSettled(
      Array.from(receivers).map(async (pubkey) => {
        const receiver = castUser(pubkey, events);

        // Use the dm relays or inboxes as the inbox relays for the participant
        const relays =
          (await receiver.directMessageRelays$.$first(1_000, undefined)) ??
          (await receiver.inboxes$.$first(1_000, undefined));

        if (relays) inboxRelays.set(pubkey, relays);
      }),
    );

    // Create the gift wraps to send
    const giftWraps: { event: NostrEvent; relays?: string[] }[] = [];
    for (const receiver of receivers) {
      const event = await factory.create(GiftWrapBlueprint, receiver, message, opts);
      const relays = inboxRelays.get(receiver);
      giftWraps.push({ event, relays });
    }

    // Publish all gift wraps in parallel
    await Promise.allSettled(giftWraps.map(({ event, relays }) => publish(event, relays)));
  };
}

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
  return async ({ factory, run }) => {
    // Create the rumor of the message
    const rumor = await factory.create(WrappedMessageBlueprint, participants, message, opts);
    await run(GiftWrapMessageToParticipants, rumor, opts);
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
  return async ({ factory, run }) => {
    // Create the reply message
    const rumor = await factory.create(WrappedMessageReplyBlueprint, parent, message, opts);
    await run(GiftWrapMessageToParticipants, rumor, opts);
  };
}
