import { kinds, NostrEvent } from "nostr-tools";
import { blueprint } from "../event-factory.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setShortTextContent, TextContentOptions } from "../operations/content.js";
import { includeLiveStreamTag } from "../operations/live-stream.js";

export type LiveChatMessageBlueprintOptions = TextContentOptions & MetaTagOptions;

/** A blueprint for creating a live stream message */
export function LiveChatMessageBlueprint(
  stream: NostrEvent,
  message: string,
  options?: LiveChatMessageBlueprintOptions,
) {
  return blueprint(
    kinds.LiveChatMessage,
    includeLiveStreamTag(stream),
    setShortTextContent(message, options),
    setMetaTags(options),
  );
}
