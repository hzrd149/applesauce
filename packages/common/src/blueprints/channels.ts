import { kinds, NostrEvent } from "nostr-tools";

import { blueprint } from "../../../factory/src/event-factory.js";
import { includeChannelPointerTag } from "../../../factory/src/operations/channel.js";
import { setShortTextContent, TextContentOptions } from "../../../factory/src/operations/content.js";
import { includeNofityTags, setThreadParent } from "applesauce-common/operations/note.js";

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
