import { kinds, NostrEvent } from "nostr-tools";

import { blueprint } from "../event-factory.js";
import { includeChannelPointerTag } from "../operations/channel.js";
import { setShortTextContent, TextContentOptions } from "../operations/content.js";
import { includeNofityTags, setThreadParent } from "../operations/note.js";

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
