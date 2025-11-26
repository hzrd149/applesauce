import { blueprint } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations";
import { includeChannelPointerTag } from "../operations/channel.js";
import { includePubkeyNotificationTags, setThreadParent } from "../operations/note.js";

/** Creates a NIP-28 channel message */
export function ChannelMessageBlueprint(channel: NostrEvent, message: string, options?: TextContentOptions) {
  return blueprint(kinds.ChannelMessage, includeChannelPointerTag(channel), setShortTextContent(message, options));
}

/** Creates a NIP-28 channel message reply */
export function ChannelMessageReplyBlueprint(parent: NostrEvent, message: string, options?: TextContentOptions) {
  return blueprint(
    kinds.ChannelMessage,
    setThreadParent(parent),
    includePubkeyNotificationTags(parent),
    setShortTextContent(message, options),
  );
}
