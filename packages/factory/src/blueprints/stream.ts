import { kinds, NostrEvent } from "nostr-tools";
import { blueprint } from "../event-factory.js";
import { EventBlueprint } from "../types.js";
import { StreamChat } from "../operations/index.js";
import { AddressPointer } from "nostr-tools/nip19";
import { TextContentOptions } from "../operations/content.js";

/** Creates a stream chat message */
export function StreamChatMessage(
  stream: AddressPointer | NostrEvent,
  content: string,
  options?: TextContentOptions,
): EventBlueprint {
  return blueprint(kinds.LiveChatMessage, StreamChat.setMessage(content, options), StreamChat.setStream(stream));
}
