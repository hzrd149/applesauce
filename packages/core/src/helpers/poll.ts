import { NostrEvent } from "nostr-tools";
import { getOrComputeCachedValue } from "./cache.js";
import { getTagValue } from "./event-tags.js";

// NIP-88 Poll kinds
export const POLL_KIND = 1068;
export const POLL_RESPONSE_KIND = 1018;

// Cache symbols
export const PollOptionsSymbol = Symbol.for("poll-options");

// Types
export interface PollOption {
  id: string;
  label: string;
}

export type PollType = "singlechoice" | "multiplechoice";

/**
 * Get the poll question/label from a poll event
 * Returns the content field which contains the poll question
 */
export function getPollQuestion(event: NostrEvent): string {
  return event.content;
}

/**
 * Get the poll options from a poll event
 * Returns array of options with id and label
 */
export function getPollOptions(event: NostrEvent): PollOption[] {
  return getOrComputeCachedValue(event, PollOptionsSymbol, () => {
    return event.tags
      .filter((tag) => tag[0] === "option" && tag.length >= 3)
      .map((tag) => ({
        id: tag[1],
        label: tag[2],
      }));
  });
}

/**
 * Get the relays specified for poll responses (from 'relay' tags)
 * Returns undefined if no relays are specified
 */
export function getPollRelays(event: NostrEvent): string[] {
  return event.tags.filter((tag) => tag[0] === "relay" && tag.length >= 2).map((tag) => tag[1]);
}

/**
 * Get the poll type from a poll event (from 'polltype' tag)
 * Returns "singlechoice" or "multiplechoice", defaults to "singlechoice"
 */
export function getPollType(event: NostrEvent): PollType {
  const type = getTagValue(event, "polltype");
  return type === "multiplechoice" || type === "singlechoice" ? type : "singlechoice";
}

/**
 * Get the poll expiration timestamp (from 'endsAt' tag)
 * Returns undefined if no expiration is set
 */
export function getPollEndsAt(event: NostrEvent): number | undefined {
  const endsAt = getTagValue(event, "endsAt");
  return endsAt ? parseInt(endsAt, 10) : undefined;
}

/**
 * Get the poll ID that a response is referencing (from 'e' tag)
 * Returns undefined if no poll reference is found
 */
export function getPollResponsePollId(event: NostrEvent): string | undefined {
  return getTagValue(event, "e");
}

/** Get the selected option IDs from a poll response event (from 'response' tags) */
export function getPollResponseOptions(event: NostrEvent): string[] {
  return event.tags.filter((tag) => tag[0] === "response" && tag.length >= 2).map((tag) => tag[1]);
}

/**
 * Gets the options that a user has voted for in a poll event
 * Returns undefined if the response is not valid
 */
export function getPollResponseVotes(poll: NostrEvent, response: NostrEvent): string[] | undefined {
  if (poll.id !== getPollResponsePollId(response)) return;

  const pollOptions = getPollOptions(poll);
  const responseOptions = getPollResponseOptions(response);
  const votes = responseOptions.filter((opts) => pollOptions.some((option) => option.id === opts));

  const type = getPollType(poll);

  // If its a single choice poll, return the first vote
  if (type === "singlechoice") return votes.length === 1 ? [votes[0]] : undefined;

  return Array.from(new Set(votes));
}
