// Chat Plane rumor operations (CORD-03 §3). Every chat rumor commits the
// channel_id and epoch it was written for; a receiver checks both against the
// key that opened the wrap and drops a mismatch (see helpers/chat.js).
//
// These are composable EventOperations that mutate a draft's public tags via
// applesauce's tag operations; the factories in ../factories/chat.js chain them
// onto a blank rumor template.

import type { EventOperation } from "applesauce-core/factories";
import { modifyPublicTags, TagOperations } from "applesauce-core/operations";
import { buildImetaTag, type MediaAttachment } from "../helpers/imeta.js";

const { addEventPointerTag, addNameValueTag, addProfilePointerTag, setSingletonTag } = TagOperations;

/** A message this rumor replies to / reacts to / targets. */
export interface ChatTarget {
  id: string;
  author: string;
  kind: number;
}

/** Bind a chat rumor to its channel + epoch (CORD-03 §3). */
export function includeChannelBinding(channelId: string, epoch: number): EventOperation {
  return modifyPublicTags(setSingletonTag(["channel", channelId]), setSingletonTag(["epoch", String(epoch)]));
}

/** Add the millisecond-resolution ordering remainder (CORD-02 §4). */
export function includeMs(ms: number = Date.now()): EventOperation {
  return modifyPublicTags(setSingletonTag(["ms", String(ms % 1000)]));
}

/** Add a NIP-C7 `q` quote tag pointing at the message being replied to. */
export function includeReplyPointer(replyTo: { id: string; author: string }): EventOperation {
  return modifyPublicTags(addNameValueTag(["q", replyTo.id, "", replyTo.author], false));
}

/** Add one NIP-92 `imeta` tag per attachment, carrying its per-file key. */
export function includeAttachments(attachments: MediaAttachment[] = []): EventOperation {
  return modifyPublicTags(
    ...attachments.map((a) => addNameValueTag(buildImetaTag(a) as [string, string, ...string[]], false)),
  );
}

/** Add the NIP-25 `e`/`p`/`k` tags pointing a reaction at its target. */
export function setReactionTarget(target: ChatTarget): EventOperation {
  return modifyPublicTags(
    addEventPointerTag(target.id, undefined, false),
    addProfilePointerTag(target.author, undefined, false),
    addNameValueTag(["k", String(target.kind)]),
  );
}

/** Add the `e`/`k` tags pointing a delete at its target (CORD-03 §3). */
export function includeDeleteTarget(id: string, kind = 9): EventOperation {
  return modifyPublicTags(addEventPointerTag(id, undefined, false), addNameValueTag(["k", String(kind)]));
}

/** Add the `e` tag pointing an edit at the message it replaces. */
export function includeEditTarget(id: string): EventOperation {
  return modifyPublicTags(addEventPointerTag(id, undefined, false));
}
