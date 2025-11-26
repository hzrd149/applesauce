import { blueprint } from "applesauce-core/event-factory";
import { NostrEvent, kinds } from "applesauce-core/helpers/event";
import { includeChannelPointerTag } from "../operations/channel.js";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations";

/** Creates a NIP-28 channel message */
export function ChannelMessageBlueprint(channel: NostrEvent, message: string, options?: TextContentOptions) {
  return blueprint(kinds.ChannelMessage, includeChannelPointerTag(channel), setShortTextContent(message, options));
}

/** Creates a NIP-28 channel message reply */
export function ChannelMessageReplyBlueprint(parent: NostrEvent, message: string, options?: TextContentOptions) {
  return blueprint(
    kinds.ChannelMessage,
    setThreadParent(parent),
    includeNofityTags(parent),
    setShortTextContent(message, options),
  );
}
