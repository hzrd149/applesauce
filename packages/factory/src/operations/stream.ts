import { StreamRole } from "applesauce-core/helpers/stream";
import { ProfilePointer } from "nostr-tools/nip19";

import { ensureMarkedProfilePointerTag } from "../helpers/common-tags.js";
import { EventOperation } from "../types.js";
import { addNameValueTag, removeNameValueTag } from "./tag/common.js";
import * as Tags from "./tag/index.js";
import { includeSingletonTag, modifyPublicTags } from "./tags.js";

// Live Event (kind:30311) Operations

/** Sets the title of a live event */
export function setTitle(title: string): EventOperation {
  return includeSingletonTag(["title", title], true);
}

/** Sets the summary/description of a live event */
export function setSummary(summary: string): EventOperation {
  return includeSingletonTag(["summary", summary], true);
}

/** Sets the preview image for a live event */
export function setImage(image: string): EventOperation {
  return includeSingletonTag(["image", image], true);
}

/** Sets the streaming URL for a live event */
export function setStreamingUrl(url: string | URL): EventOperation {
  return includeSingletonTag(["streaming", new URL(url).toString()], true);
}

/** Sets the recording URL for a live event (typically after the event ends) */
export function setRecordingUrl(url: string | URL): EventOperation {
  return includeSingletonTag(["recording", new URL(url).toString()], true);
}

/** Sets the start timestamp for a live event */
export function setStartTime(start: number | Date): EventOperation {
  const timestamp = typeof start === "number" ? start : Math.round(new Date(start).valueOf() / 1000);
  return includeSingletonTag(["starts", String(timestamp)], true);
}

/** Sets the end timestamp for a live event */
export function setEndTime(end: number | Date): EventOperation {
  const timestamp = typeof end === "number" ? end : Math.round(new Date(end).valueOf() / 1000);
  return includeSingletonTag(["ends", String(timestamp)], true);
}

/** Sets the status of a live event */
export function setStatus(status: "planned" | "live" | "ended"): EventOperation {
  return includeSingletonTag(["status", status], true);
}

/** Sets the current number of participants */
export function setCurrentViewers(count: number): EventOperation {
  return includeSingletonTag(["current_participants", String(count)], true);
}

/** Sets the total number of participants */
export function setMaxViewers(count: number): EventOperation {
  return includeSingletonTag(["total_participants", String(count)], true);
}

/** Sets the host of the stream */
export function setHost(user: ProfilePointer): EventOperation {
  return modifyPublicTags((tags) => ensureMarkedProfilePointerTag(tags, user, "host"));
}

/** Adds a participant to a live event with role and optional relay */
export function addParticipant(user: ProfilePointer, role: StreamRole): EventOperation {
  return modifyPublicTags((tags) => ensureMarkedProfilePointerTag(tags, user, role));
}

/** Removes a participant from a live event */
export function removeParticipant(pubkey: string): EventOperation {
  return modifyPublicTags(removeNameValueTag(["p", pubkey]));
}

/** Adds a relay to the live event's relay list */
export function addRelay(relay: string | URL): EventOperation {
  return modifyPublicTags(addNameValueTag(["relays", new URL(relay).toString()] as [string, string], true));
}

/** Removes a relay from the live event's relay list */
export function removeRelay(relay: string | URL): EventOperation {
  return modifyPublicTags(removeNameValueTag(["relays", new URL(relay).toString()]));
}

/** Sets a pinned live chat message */
export function setPinnedMessage(eventId: string): EventOperation {
  return includeSingletonTag(["pinned", eventId], true);
}

/** Removes the pinned live chat message */
export function removePinnedMessage(): EventOperation {
  return modifyPublicTags((tags) => tags.filter((tag) => tag[0] !== "pinned"));
}

/** Adds a hashtag to the live event */
export function addHashtag(hashtag: string): EventOperation {
  return modifyPublicTags(Tags.addHashtag(hashtag));
}

/** Removes a hashtag from the live event */
export function removeHashtag(hashtag: string): EventOperation {
  return modifyPublicTags(Tags.removeHashtag(hashtag));
}
