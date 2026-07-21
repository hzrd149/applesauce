// Chat Plane rumor operations (CORD-03 §3). Every chat rumor commits the
// channel_id and epoch it was written for; a receiver checks both against the
// key that opened the wrap and drops a mismatch (see helpers/chat.js).
//
// The generic chat-message machinery (content, `q` replies, NIP-92 attachments,
// NIP-25 reaction targets) is reused from applesauce-common; this module only
// holds the Concord-specific bits: the channel/epoch binding, the `ms` ordering
// remainder, and the client-media encryption decorator.

import type { EventOperation } from "applesauce-core/factories";
import { eventPipe } from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import { setSingletonTag } from "applesauce-core/operations/tag/common";
import type { AttachmentEncryption } from "../helpers/imeta.js";
import { splitTime } from "../helpers/stream.js";

/** Bind a chat rumor to its channel + epoch (CORD-03 §3). */
export function includeChannelBinding(channelId: string, epoch: number): EventOperation {
  return modifyPublicTags(setSingletonTag(["channel", channelId]), setSingletonTag(["epoch", String(epoch)]));
}

/**
 * Add the millisecond-resolution ordering remainder AND stamp `created_at`
 * from the same single clock read (CORD-02 §4, TIME-01/D-06/D-07). `ms` is
 * decomposed exactly once via {@link splitTime}, so `draft.created_at * 1000
 * + Number(msTag)` is always a true reconstruction of the passed/defaulted
 * `ms` value — no separate `Date.now()` read and no round-vs-floor skew.
 * This is the choke point every channel-plane send (`bindToChannel`) and the
 * Kick/JoinLeave factories funnel through, so the fix propagates to all of
 * them without further edits.
 */
export function includeMs(ms: number = Date.now()): EventOperation {
  return async (draft) => {
    const { created_at, ms: remainder } = splitTime(ms);
    const withTag = await modifyPublicTags(setSingletonTag(["ms", String(remainder)]))(draft);
    return { ...withTag, created_at };
  };
}

/**
 * Bind ANY event to a Concord channel (CORD-03 §3) as a single composable
 * operation: appends the channel/epoch binding plus the CORD-02 `ms` ordering
 * remainder. Because it is a plain `EventOperation`, it chains onto any
 * applesauce factory (e.g. `ChatMessageFactory.create(text).chain(bindToChannel(...))`)
 * or applies to a resolved template, and it preserves the original kind so any
 * nostr kind can ride a channel.
 */
export function bindToChannel(channelId: string, epoch: number, ms?: number) {
  const channel = includeChannelBinding(channelId, epoch);
  const remainder = includeMs(ms);
  return eventPipe(channel, remainder);
}

/** A client-encryption entry keyed to the attachment's `url`. */
export type MediaEncryption = { url: string } & AttachmentEncryption;

/**
 * Decorate the NIP-92 `imeta` tags built by applesauce-common's
 * `addMediaAttachments` with Concord's client-encryption fields
 * (`encryption-algorithm` / `decryption-key` / `decryption-nonce`). Each entry
 * is matched to its `imeta` tag by `url`, so the base attachment tags must
 * already be present on the draft.
 */
export function includeMediaEncryption(entries: MediaEncryption[] = []): EventOperation {
  if (entries.length === 0) return (draft) => draft;
  return modifyPublicTags((tags) =>
    tags.map((tag) => {
      if (tag[0] !== "imeta") return tag;
      const url = tag.find((part, i) => i > 0 && part.startsWith("url "))?.slice(4);
      const enc = entries.find((e) => e.url === url);
      if (!enc) return tag;
      return [
        ...tag,
        `encryption-algorithm ${enc.algorithm}`,
        `decryption-key ${enc.key}`,
        `decryption-nonce ${enc.nonce}`,
      ];
    }),
  );
}
