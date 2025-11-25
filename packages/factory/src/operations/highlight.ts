import { HighlightAttribution } from "applesauce-common/helpers/highlight";
import { NostrEvent, isEvent, isReplaceable } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  isAddressPointer,
  isEventPointer,
} from "applesauce-core/helpers/pointers";

import { ensureMarkedProfilePointerTag } from "../helpers/common-tags.js";
import { EventOperation } from "../types.js";
import { addAddressTag, addEventTag } from "./tag/common.js";
import { includeSingletonTag, modifyPublicTags } from "./tags.js";

/** Sets the content (highlighted text) for a highlight event */
export function setHighlightContent(content: string): EventOperation {
  return (draft) => ({ ...draft, content });
}

/** Sets the source event that was highlighted using an 'e' tag */
export function setSource(source: NostrEvent | EventPointer | AddressPointer | string): EventOperation {
  if (isEvent(source)) {
    if (isReplaceable(source.kind))
      return modifyPublicTags(addEventTag(source, true), addAddressTag(getAddressPointerForEvent(source), true));
    else return modifyPublicTags(addEventTag(source, true));
  } else if (isAddressPointer(source)) {
    return modifyPublicTags(addAddressTag(source, true));
  } else if (isEventPointer(source)) return modifyPublicTags(addEventTag(source, true));
  else if (typeof source === "string") return includeSingletonTag(["r", source]);
  else throw new Error("Invalid source");
}

/** Attribution role types for highlight events */
export type AttributionRole = "author" | "editor" | "mention";

/** Sets attribution for a pubkey with optional role using 'p' tags */
export function addAttribution(attribution: HighlightAttribution): EventOperation {
  return modifyPublicTags((tags) => ensureMarkedProfilePointerTag(tags, attribution, attribution.role || "mention"));
}

/** Sets the context text for the highlight using a 'context' tag */
export function setContext(context: string): EventOperation {
  return includeSingletonTag(["context", context]);
}

/** Sets a comment for the highlight using a 'comment' tag to create a quote highlight */
export function setComment(comment: string): EventOperation {
  return includeSingletonTag(["comment", comment]);
}

/** Sets multiple attributions at once */
export function setAttributions(attributions: HighlightAttribution[]): EventOperation {
  return modifyPublicTags(async (tags) => {
    for (const attribution of attributions)
      tags = ensureMarkedProfilePointerTag(tags, attribution, attribution.role || "mention");

    return tags;
  });
}
