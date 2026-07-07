// Chat Plane rumor builders (CORD-03 §3). Every chat rumor commits the
// channel_id and epoch it was written for; a receiver checks both against the
// key that opened the wrap and drops a mismatch.

import { includeEmojis, tagPubkeyMentions } from "applesauce-core/operations";
import type { Emoji } from "applesauce-core/factories";
import type { RumorTemplate } from "../types.js";
import { KIND } from "../types.js";
import { buildImetaTag, type MediaAttachment } from "./imeta.js";

export type { Emoji };

/**
 * Add NIP-30 `["emoji", …]` tags for every `:shortcode:` in `content` that
 * matches one of `emojis`, using applesauce's operation so the shortcode regex
 * and pack-address handling stay spec-correct. Returns the merged tags.
 */
function withEmojiTags(content: string, tags: string[][], emojis?: Emoji[]): string[][] {
  if (!emojis?.length) return tags;
  // `includeEmojis` is synchronous; the placeholder kind/created_at are discarded.
  const draft = includeEmojis(emojis)({ kind: 0, content, tags, created_at: 0 }) as { tags: string[][] };
  return draft.tags;
}

/**
 * Add a NIP-C7 `["p", pubkey]` tag for every `nostr:npub…`/`nostr:nprofile…`
 * mention in `content`, using applesauce's operation so notification-worthy
 * mentions are tagged the same way the wider ecosystem expects. Idempotent —
 * it won't duplicate a `p` tag already present. Returns the merged tags.
 */
function withMentionTags(content: string, tags: string[][]): string[][] {
  const draft = tagPubkeyMentions()({ kind: 0, content, tags, created_at: 0 }) as { tags: string[][] };
  return draft.tags;
}

function base(channelId: string, epoch: number): string[][] {
  return [
    ["channel", channelId],
    ["epoch", String(epoch)],
    ["ms", String(Date.now() % 1000)],
  ];
}

export function messageRumor(
  channelId: string,
  epoch: number,
  text: string,
  replyTo?: { id: string; author: string },
  attachments?: MediaAttachment[],
  emojis?: Emoji[],
): RumorTemplate {
  const tags = base(channelId, epoch);
  if (replyTo) tags.push(["q", replyTo.id, "", replyTo.author]);
  // NIP-92: one imeta tag per attachment, carrying the per-file decryption key.
  for (const a of attachments ?? []) tags.push(buildImetaTag(a));
  // NIP-C7: `p` tag each `nostr:` mention, then NIP-30 emoji tags for each
  // `:shortcode:` used in the text.
  return { kind: KIND.MESSAGE, content: text, tags: withEmojiTags(text, withMentionTags(text, tags), emojis) };
}

export function reactionRumor(
  channelId: string,
  epoch: number,
  target: { id: string; author: string; kind: number },
  reaction: string | Emoji,
): RumorTemplate {
  const tags = base(channelId, epoch);
  tags.push(["e", target.id], ["p", target.author], ["k", String(target.kind)]);
  // NIP-25/NIP-30: a plain emoji rides in content; a custom emoji rides as a
  // `:shortcode:` in content plus a single emoji tag naming its image.
  if (typeof reaction === "string") return { kind: KIND.REACTION, content: reaction, tags };
  const content = `:${reaction.shortcode}:`;
  return { kind: KIND.REACTION, content, tags: withEmojiTags(content, tags, [reaction]) };
}

export function deleteRumor(channelId: string, epoch: number, targetId: string, targetKind = 9): RumorTemplate {
  const tags = base(channelId, epoch);
  tags.push(["e", targetId], ["k", String(targetKind)]);
  return { kind: KIND.DELETE, content: "", tags };
}

export function editRumor(channelId: string, epoch: number, targetId: string, newText: string): RumorTemplate {
  const tags = base(channelId, epoch);
  tags.push(["e", targetId]);
  return { kind: KIND.EDIT, content: newText, tags };
}

/** Validate a decoded chat rumor's channel/epoch binding (CORD-03 §3). */
export function checkChatBinding(tags: string[][], channelId: string, epoch: number): boolean {
  const ch = tags.find((t) => t[0] === "channel")?.[1];
  const ep = tags.find((t) => t[0] === "epoch")?.[1];
  return ch === channelId && ep === String(epoch);
}
