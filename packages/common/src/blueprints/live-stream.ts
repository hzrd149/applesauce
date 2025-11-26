import { kinds, NostrEvent } from "nostr-tools";
import { blueprint } from "../../../factory/src/event-factory.jsnt-factory.js";
import { MetaTagOptions, setMetaTags } from "../../../factory/src/operations/common.js-operations/common.js";
import { setShortTextContent, TextContentOptions } from "../../../factory/src/operations/content.jsoperations/content.js";
import { includeLiveStreamTag } from "../../../factory/src/operations/live-stream.js/live-stream.js";

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
