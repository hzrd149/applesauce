import { buildEvent, Emoji, EventFactoryServices } from "applesauce-core/event-factory";
import { EventBlueprint } from "applesauce-core/event-factory";
import { Rumor } from "../helpers/gift-wrap.js";
import { kinds } from "applesauce-core/helpers/event";
import { repairNostrLinks, setContent } from "applesauce-core/operations";
import { setConversation, setParent, setSubject } from "../operations/wrapped-message.js";
import { includeEmojis } from "applesauce-core/operations/content";
import { toRumor } from "../operations/gift-wrap.js";
import { getConversationParticipants } from "../helpers/messages.js";

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
  return async (services: EventFactoryServices) => {
    if (!services.signer) throw new Error("Missing signer");
    const self = await services.signer.getPublicKey();

    return buildEvent(
      { kind: kinds.PrivateDirectMessage },
      services,
      // set text content
      setContent(message),
      // fix @ mentions
      repairNostrLinks(),
      // Include the "p" tags for the conversation
      setConversation(participants, self),
      // include "emoji" tags
      opts?.emojis ? includeEmojis(opts?.emojis ?? services.emojis ?? []) : undefined,
      // Include the subject if provided
      opts?.subject ? setSubject(opts.subject) : undefined,
      // Convert the event to a rumor
      toRumor(services.signer),
    ) as Promise<Rumor>;
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
  return async (services: EventFactoryServices) => {
    if (typeof parent !== "string" && parent.kind !== kinds.PrivateDirectMessage)
      throw new Error("Parent must be a wrapped message event (kind 14)");

    if (!services.signer) throw new Error("Missing signer");
    const self = await services.signer.getPublicKey();

    // Get the identifier for the conversation
    const participants = getConversationParticipants(parent);

    return buildEvent(
      { kind: kinds.PrivateDirectMessage },
      services,
      // set text content
      setContent(message),
      // fix @ mentions
      repairNostrLinks(),
      // Include the "p" tags for the conversation
      setConversation(participants, self),
      // Include the parent message id
      setParent(parent),
      // include "emoji" tags
      opts?.emojis ? includeEmojis(opts?.emojis ?? services.emojis ?? []) : undefined,
      // Include the subject if provided
      opts?.subject ? setSubject(opts.subject) : undefined,
      // Convert the event to a rumor
      toRumor(services.signer),
    ) as Promise<Rumor>;
  };
}
