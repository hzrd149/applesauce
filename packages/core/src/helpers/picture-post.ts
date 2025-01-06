import { NostrEvent } from "nostr-tools";
import { getMediaAttachments } from "./file-metadata.js";

export const PICTURE_POST_KIND = 20;

/** Return the media attachments from a kind 20 media post */
export function getPicturePostAttachments(post: NostrEvent) {
  return getMediaAttachments(post);
}
