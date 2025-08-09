import { PollType } from "applesauce-core/helpers";
import { NostrEvent } from "nostr-tools";
import { EventPointer } from "nostr-tools/nip19";

import { EventOperation } from "../types.js";
import { addEventTag } from "./tag/common.js";
import { includeSingletonTag, modifyPublicTags } from "./tags.js";

/** Sets the content (poll question/label) for a poll event */
export function setPollQuestion(question: string): EventOperation {
  return (draft) => ({ ...draft, content: question });
}

/** Adds an option to a poll with an option ID and label */
export function addPollOption(optionId: string, label: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["option", optionId, label]]);
}

/** Sets multiple poll options at once, replacing any existing option tags */
export function setPollOptions(options: Array<{ id: string; label: string }>): EventOperation {
  return modifyPublicTags((tags) => {
    // Remove existing option tags
    const filteredTags = tags.filter((tag) => tag[0] !== "option");

    // Add new option tags
    const optionTags = options.map((option) => ["option", option.id, option.label] as [string, string, string]);

    return [...filteredTags, ...optionTags];
  });
}

/** Sets the poll type (singlechoice or multiplechoice) */
export function setPollType(pollType: PollType): EventOperation {
  return includeSingletonTag(["polltype", pollType]);
}

/** Sets the poll expiration timestamp */
export function setPollEndsAt(timestamp: number): EventOperation {
  return includeSingletonTag(["endsAt", timestamp.toString()]);
}

/** Adds a relay URL where poll responses should be published */
export function addPollRelay(relayUrl: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["relay", relayUrl]]);
}

/** Sets multiple relay URLs at once, replacing any existing relay tags */
export function setPollRelays(relayUrls: string[]): EventOperation {
  return modifyPublicTags((tags) => {
    // Remove existing relay tags
    const filteredTags = tags.filter((tag) => tag[0] !== "relay");

    // Add new relay tags
    const relayTags = relayUrls.map((url) => ["relay", url] as [string, string]);

    return [...filteredTags, ...relayTags];
  });
}

// Poll Response Operations

/** Sets the poll event that this response is for using an 'e' tag */
export function setPollResponsePoll(poll: NostrEvent | EventPointer | string): EventOperation {
  if (typeof poll === "string") {
    return modifyPublicTags((tags) => {
      // Remove existing e tags
      const filteredTags = tags.filter((tag) => tag[0] !== "e");
      return [...filteredTags, ["e", poll]];
    });
  } else if ("id" in poll && typeof poll.id === "string") {
    // It's an EventPointer
    return modifyPublicTags(addEventTag(poll, true));
  } else {
    // It's a NostrEvent
    return modifyPublicTags(addEventTag((poll as NostrEvent).id, true));
  }
}

/** Adds a response option to a poll response */
export function addPollResponse(optionId: string): EventOperation {
  return modifyPublicTags((tags) => [...tags, ["response", optionId]]);
}

/** Sets multiple response options at once, replacing any existing response tags */
export function setPollResponses(optionIds: string[]): EventOperation {
  return modifyPublicTags((tags) => {
    // Remove existing response tags
    const filteredTags = tags.filter((tag) => tag[0] !== "response");

    // Add new response tags
    const responseTags = optionIds.map((id) => ["response", id] as [string, string]);

    return [...filteredTags, ...responseTags];
  });
}

/** Sets a single response option, replacing any existing response tags (for single choice polls) */
export function setPollResponseChoice(optionId: string): EventOperation {
  return setPollResponses([optionId]);
}
