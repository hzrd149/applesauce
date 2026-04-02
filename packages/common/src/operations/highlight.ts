import { EventOperation } from "applesauce-core/factories";
import { ensureMarkedProfilePointerTag } from "applesauce-core/helpers";
import { isEvent, isReplaceable, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  isAddressPointer,
  isEventPointer,
} from "applesauce-core/helpers/pointers";
import { addAddressPointerTag, addEventPointerTag } from "applesauce-core/operations/tag/common";
import { includeSingletonTag, modifyPublicTags } from "applesauce-core/operations/tags";
import { HighlightAttribution } from "../helpers/highlight.js";

/** Sets the content (highlighted text) for a highlight event */
export function setHighlightContent(content: string): EventOperation {
  return (draft) => ({ ...draft, content });
}

/** Sets the source event that was highlighted using an 'e' tag */
export function setSource(source: NostrEvent | EventPointer | AddressPointer | string): EventOperation {
  if (isEvent(source)) {
    if (isReplaceable(source.kind)) {
      const address = getAddressPointerForEvent(source);
      if (address) {
        // Include both the event pointer and address pointer
        return modifyPublicTags(
          addEventPointerTag(source, undefined, true),
          addAddressPointerTag(address, undefined, true),
        );
      } else {
        // Just include the event pointer
        return modifyPublicTags(addEventPointerTag(source, undefined, true));
      }
    } else {
      // Include the event pointer for normal events
      return modifyPublicTags(addEventPointerTag(source, undefined, true));
    }
  } else if (isAddressPointer(source)) {
    // Include "a" tag for address pointers
    return modifyPublicTags(addAddressPointerTag(source, undefined, true));
  } else if (isEventPointer(source)) {
    // Include "e" tag for event pointers
    return modifyPublicTags(addEventPointerTag(source, undefined, true));
  } else if (typeof source === "string") {
    // Include "r" tags for URLs
    return includeSingletonTag(["r", source]);
  } else throw new Error("Invalid source");
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
