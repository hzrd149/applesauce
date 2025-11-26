import { NostrEvent } from "applesauce-core/helpers/event";
import { EventPointer } from "nostr-tools/nip19";

import { EventOperation } from "../types.js";
import { modifyPublicTags } from "./tags.js";
import { addEventTag } from "./tag/common.js";

/** Sets the poll event that this response is for using an 'e' tag */
export function setPollEvent(poll: NostrEvent | EventPointer | string): EventOperation {
  return modifyPublicTags(addEventTag(poll, true));
}

/** Sets multiple response options at once, replacing any existing response tags */
export function setChoices(optionIds: string[]): EventOperation {
  return modifyPublicTags((tags) => {
    // Remove existing response tags
    const filteredTags = tags.filter((tag) => tag[0] !== "response");

    // Add new response tags
    const responseTags = optionIds.map((id) => ["response", id] as [string, string]);

    return [...filteredTags, ...responseTags];
  });
}

/** Sets a single response option, replacing any existing response tags (for single choice polls) */
export function setChoice(optionId: string): EventOperation {
  return setChoices([optionId]);
}
