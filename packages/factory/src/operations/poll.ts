import { PollType } from "applesauce-core/helpers";

import { EventOperation } from "../types.js";
import { includeSingletonTag, modifyPublicTags } from "./tags.js";

/** Sets the content (poll question/label) for a poll event */
export function setQuestion(question: string): EventOperation {
  return (draft) => ({ ...draft, content: question });
}

/** Adds an option to a poll with an option ID and label */
export function addOption(optionId: string, label: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["option", optionId, label]]);
}

/** Sets multiple poll options at once, replacing any existing option tags */
export function setOptions(options: Array<{ id: string; label: string }>): EventOperation {
  return modifyPublicTags((tags) => {
    // Remove existing option tags
    const filteredTags = tags.filter((tag) => tag[0] !== "option");

    // Add new option tags
    const optionTags = options.map((option) => ["option", option.id, option.label] as [string, string, string]);

    return [...filteredTags, ...optionTags];
  });
}

/** Sets the poll type (singlechoice or multiplechoice) */
export function setType(pollType: PollType): EventOperation {
  return includeSingletonTag(["polltype", pollType]);
}

/** Sets the poll expiration timestamp */
export function setEndsAt(timestamp: number): EventOperation {
  return includeSingletonTag(["endsAt", timestamp.toString()]);
}

/** Adds a relay URL where poll responses should be published */
export function addRelay(relayUrl: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["relay", relayUrl]]);
}

/** Sets multiple relay URLs at once, replacing any existing relay tags */
export function setRelays(relayUrls: string[]): EventOperation {
  return modifyPublicTags((tags) => {
    // Remove existing relay tags
    const filteredTags = tags.filter((tag) => tag[0] !== "relay");

    // Add new relay tags
    const relayTags = relayUrls.map((url) => ["relay", url] as [string, string]);

    return [...filteredTags, ...relayTags];
  });
}
