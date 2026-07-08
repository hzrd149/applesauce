// NIP-7D forum threads riding a Concord channel. A thread is a kind 11 rumor
// bound to the channel (like a kind 9 message); its replies are NIP-22 kind 1111
// comments to the root thread (`["K","11"]` / `["E", <thread-id>, …]`), also
// bound to the channel. `foldThreads` collapses a channel's decoded rumors into
// threads with their replies, mirroring `recomputeMessages` for chat.

import type { NostrEvent } from "applesauce-core/helpers/event";
import { getForumThreadTitle } from "applesauce-common/helpers";
import { KIND } from "../types.js";
import type { DecodedEvent } from "../types.js";

/** A NIP-22 kind 1111 reply to a channel thread. */
export interface ThreadReply {
  id: string;
  author: string;
  content: string;
  ms: number;
  raw: DecodedEvent;
}

/** A NIP-7D kind 11 thread posted to a channel, with its folded replies. */
export interface ChannelThread {
  id: string;
  author: string;
  title?: string;
  content: string;
  ms: number;
  replies: ThreadReply[];
  raw: DecodedEvent;
}

/** Fold a channel's decoded rumors into NIP-7D threads (kind 11) + kind 1111 replies. */
export function foldThreads(events: Iterable<DecodedEvent>): ChannelThread[] {
  const byId = new Map<string, ChannelThread>();
  const replies: DecodedEvent[] = [];

  const sorted = [...events].sort((a, b) => a.ms - b.ms);
  for (const d of sorted) {
    const r = d.rumor;
    if (r.kind === KIND.THREAD) {
      byId.set(r.id, {
        id: r.id,
        author: d.author,
        title: getForumThreadTitle(r as unknown as NostrEvent),
        content: r.content,
        ms: d.ms,
        replies: [],
        raw: d,
      });
    } else if (r.kind === KIND.COMMENT) {
      replies.push(d);
    }
  }

  // Attach each reply to its root thread via the NIP-22 uppercase "E" root tag.
  for (const d of replies) {
    const rootId = d.rumor.tags.find((t) => t[0] === "E")?.[1];
    const thread = rootId ? byId.get(rootId) : undefined;
    if (thread)
      thread.replies.push({ id: d.rumor.id, author: d.author, content: d.rumor.content, ms: d.ms, raw: d });
  }

  return [...byId.values()];
}
