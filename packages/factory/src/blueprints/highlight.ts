import { HighlightAttribution } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "nostr-tools";
import { AddressPointer } from "nostr-tools/nip19";

import { blueprint } from "../event-factory.js";
import { includeAltTag, MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setAttributions, setComment, setContext, setHighlightContent, setSource } from "../operations/highlight.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type HighlightBlueprintOptions = MetaTagOptions &
  ZapOptions & {
    /** Additional context surrounding the highlight */
    context?: string;
    /** Comment to create a quote highlight */
    comment?: string;
    /** Attribution information for the original content */
    attributions?: HighlightAttribution[];
    /** Alt description for clients that can't render the event */
    alt?: string;
  };

/**
 * NIP-84 Highlight event (kind 9802) blueprint
 * Creates a highlight event that references content from nostr events or external URLs
 */
export function HighlightBlueprint(
  content: string,
  source: NostrEvent | AddressPointer | string,
  options?: HighlightBlueprintOptions,
) {
  return blueprint(
    kinds.Highlights,
    setHighlightContent(content),
    setSource(source),
    options?.attributions ? setAttributions(options.attributions) : undefined,
    options?.context ? setContext(options.context) : undefined,
    options?.comment ? setComment(options.comment) : undefined,
    setZapSplit(options),
    setMetaTags(options),
    includeAltTag(options?.alt ?? "A text highlight"),
  );
}
