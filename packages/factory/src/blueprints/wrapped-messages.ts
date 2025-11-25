import { Emoji } from "applesauce-common/helpers/emoji";
import { getConversationParticipants } from "applesauce-common/helpers/messages";
import { kinds } from "applesauce-core/helpers/event";
import { Rumor } from "applesauce-core/helpers/gift-wraps";

import { blueprint } from "../event-factory.js";
import { includeEmojis, repairNostrLinks, setContent } from "../operations/content.js";
import { toRumor } from "../operations/gift-wrap.js";
import { setConversation, setParent, setSubject } from "../operations/wrapped-message.js";
import { EventBlueprint } from "../types.js";

export type WrappedMessageBlueprintOptions = {
  emojis?: Emoji[];
  subject?: string;
};

/**
 * A blueprint that creates a wrapped message event to a conversation
 * @param participants - The conversation identifier (pubkey1:pubkey2:pubkey3), a users pubkey, or a list of participant pubkeys
 * @param message - The message to wrap
 * @returns A blueprint that creates a wrapped message event to a conversation
 */
export function WrappedMessageBlueprint(
  participants: string | string[],
  message: string,
  opts?: WrappedMessageBlueprintOptions,
): EventBlueprint<Rumor> {
  return async (context) => {
    if (!context.signer) throw new Error("Missing signer");
    const self = await context.signer.getPublicKey();

    return blueprint(
      kinds.PrivateDirectMessage,
      // set text content
      setContent(message),
      // fix @ mentions
      repairNostrLinks(),
      // Include the "p" tags for the conversation
      setConversation(participants, self),
      // include "emoji" tags
      opts?.emojis ? includeEmojis(opts.emojis) : undefined,
      // Include the subject if provided
      opts?.subject ? setSubject(opts.subject) : undefined,
      // Convert the event to a rumor
      toRumor(),
    )(context) as Promise<Rumor>;
  };
}

/**
 * A blueprint that creates a reply to a wrapped message event
 * @param message - The message to wrap
 * @returns A blueprint that creates a wrapped message event to a conversation
 */
export function WrappedMessageReplyBlueprint(
  parent: Rumor,
  message: string,
  opts?: WrappedMessageBlueprintOptions,
): EventBlueprint<Rumor> {
  return async (context) => {
    if (typeof parent !== "string" && parent.kind !== kinds.PrivateDirectMessage)
      throw new Error("Parent must be a wrapped message event (kind 14)");

    if (!context.signer) throw new Error("Missing signer");
    const self = await context.signer.getPublicKey();

    // Get the identifier for the conversation
    const participants = getConversationParticipants(parent);

    return blueprint(
      kinds.PrivateDirectMessage,
      // set text content
      setContent(message),
      // fix @ mentions
      repairNostrLinks(),
      // Include the "p" tags for the conversation
      setConversation(participants, self),
      // Include the parent message id
      setParent(parent),
      // include "emoji" tags
      opts?.emojis ? includeEmojis(opts.emojis) : undefined,
      // Include the subject if provided
      opts?.subject ? setSubject(opts.subject) : undefined,
      // Convert the event to a rumor
      toRumor(),
    )(context) as Promise<Rumor>;
  };
}
