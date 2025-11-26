import { kinds, NostrEvent } from "nostr-tools";
import { blueprint } from "../../../factory/src/event-factory.jsnt-factory.js";
import { EventBlueprint } from "../../../factory/src/types.jscore/factory-types.js";
import { StreamChat } from "../../../factory/src/operations/index.jsations/stream-chat.js";
import { AddressPointer } from "nostr-tools/nip19";
import { TextContentOptions } from "../../../factory/src/operations/content.jsoperations/content.js";

/** Creates a stream chat message */
export function StreamChatMessage(
  stream: AddressPointer | NostrEvent,
  content: string,
  options?: TextContentOptions,
): EventBlueprint {
  return blueprint(kinds.LiveChatMessage, StreamChat.setMessage(content, options), StreamChat.setStream(stream));
}
