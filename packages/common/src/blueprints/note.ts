import { kinds } from "nostr-tools";

import { blueprint } from "../../../factory/src/event-factory.js";
import { MetaTagOptions, setMetaTags } from "../../../factory/src/operations/common.js";
import { setShortTextContent, TextContentOptions } from "../../../factory/src/operations/content.js";
import { setZapSplit, ZapOptions } from "applesauce-common/operations/zap-split.js";

export type NoteBlueprintOptions = TextContentOptions & MetaTagOptions & ZapOptions;

/** Short text note (kind 1) blueprint */
export function NoteBlueprint(content: string, options?: NoteBlueprintOptions) {
  return blueprint(
    kinds.ShortTextNote,
    setShortTextContent(content, options),
    setZapSplit(options),
    setMetaTags(options),
  );
}
