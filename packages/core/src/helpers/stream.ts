import { NostrEvent } from "nostr-tools";
import { EventPointer, ProfilePointer } from "nostr-tools/nip19";
import { getTagValue } from "./event-tags.js";
import { addRelayHintsToPointer, getEventPointerFromETag, getProfilePointerFromPTag } from "./pointers.js";
import { mergeRelaySets } from "./relays.js";
import { isPTag } from "./tags.js";
import { unixNow } from "./time.js";

export type StreamStatus = "live" | "ended" | "planned";
export type StreamRole = "host" | "participant" | "speaker";

export function getStreamTitle(stream: NostrEvent): string | undefined {
  return getTagValue(stream, "title");
}
export function getStreamSummary(stream: NostrEvent): string | undefined {
  return getTagValue(stream, "summary");
}
export function getStreamImage(stream: NostrEvent): string | undefined {
  return getTagValue(stream, "image");
}

const TWO_WEEKS = 60 * 60 * 24 * 14;

/** Returns the status of the stream, defaults to ended if the stream is older than 2 weeks */
export function getStreamStatus(stream: NostrEvent): StreamStatus {
  if (stream.created_at < unixNow() - TWO_WEEKS) return "ended";
  else return (getTagValue(stream, "status") as StreamStatus) || "ended";
}

/** Returns the pubkey of the host of the stream */
export function getStreamHost(stream: NostrEvent): ProfilePointer {
  let host: ProfilePointer | undefined = undefined;

  for (const tag of stream.tags) {
    if (isPTag(tag) && (!host || (tag[3] && tag[3].toLowerCase() === "host"))) {
      host = getProfilePointerFromPTag(tag);
    }
  }

  return host || { pubkey: stream.pubkey };
}

/** Returns the participants of a stream */
export function getStreamParticipants(stream: NostrEvent): (ProfilePointer & { role: StreamRole })[] {
  return stream.tags
    .filter((t) => isPTag(t) && t[3])
    .map((t) => ({ ...getProfilePointerFromPTag(t), role: t[3].toLowerCase() as StreamRole }));
}

export function getStreamGoalPointer(stream: NostrEvent): EventPointer | undefined {
  const goalTag = stream.tags.find((t) => t[0] === "goal");
  return goalTag && addRelayHintsToPointer(getEventPointerFromETag(goalTag), getStreamRelays(stream));
}

/** Gets all the streaming urls for a stream */
export function getStreamStreamingURLs(stream: NostrEvent) {
  return stream.tags.filter((t) => t[0] === "streaming").map((t) => t[1]);
}

export function getStreamRecording(stream: NostrEvent) {
  return getTagValue(stream, "recording");
}

/** Gets the relays for a stream */
export function getStreamRelays(stream: NostrEvent): string[] | undefined {
  for (const tag of stream.tags) {
    if (tag[0] === "relays") return mergeRelaySets(tag.slice(1));
  }

  return undefined;
}

/** Gets the stream start time if it has one */
export function getStreamStartTime(stream: NostrEvent): number | undefined {
  const str = getTagValue(stream, "starts");
  return str ? parseInt(str) : undefined;
}

/** Gets the stream end time if it has one */
export function getStreamEndTime(stream: NostrEvent): number | undefined {
  const str = getTagValue(stream, "ends");
  return str ? parseInt(str) : getStreamStatus(stream) === "ended" ? stream.created_at : undefined;
}

/** Returns the current number of participants in the stream */
export function getStreamViewers(stream: NostrEvent): number | undefined {
  const viewers = getTagValue(stream, "current_participants");
  return viewers ? parseInt(viewers) : undefined;
}

/** Returns the maximum number of participants in the stream */
export function getStreamMaxViewers(stream: NostrEvent): number | undefined {
  const viewers = getTagValue(stream, "total_participants");
  return viewers ? parseInt(viewers) : undefined;
}

/** Returns the hashtags for a stream */
export function getStreamHashtags(stream: NostrEvent) {
  return stream.tags.filter((t) => t[0] === "t").map((t) => t[1]);
}
