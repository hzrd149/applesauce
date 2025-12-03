import { blueprint } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
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
