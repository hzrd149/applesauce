// Chat Plane rumor factories (CORD-03). The generic chat message (kind 9) and
// reaction (kind 7) are built with the applesauce-common `ChatMessageFactory`
// and `ReactionFactory` and bound to a channel with `bindToChannel`
// (../operations/chat.js); only the Concord-specific delete (kind 5) and edit
// (kind 3302, ../factories/edit.js) keep dedicated factories here. Each builds
// an unsigned rumor template; the rumor is sealed + wrapped later by
// ../stream.js, so these factories never sign.

import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { kinds } from "applesauce-core/helpers/event";
import { includeChannelBinding, includeDeleteTarget, includeMs } from "../operations/chat.js";

/**
 * Shared base for chat-plane rumor factories. Every chat rumor commits the
 * channel_id + epoch it was written for and an `ms` ordering remainder (CORD-03
 * §3, CORD-02 §4).
 */
export class ChatRumorFactory<K extends number = number> extends EventFactory<K> {
  /** Binds this rumor to its channel + epoch (CORD-03 §3) */
  channel(channelId: string, epoch: number) {
    return this.chain(includeChannelBinding(channelId, epoch));
  }

  /** Adds the millisecond-resolution ordering remainder (CORD-02 §4) */
  ms(ms?: number) {
    return this.chain(includeMs(ms));
  }
}

/** A factory for kind 5 chat deletes (CORD-03 §3). */
export class DeleteFactory extends ChatRumorFactory<kinds.EventDeletion> {
  static create(channelId: string, epoch: number, targetId: string, targetKind = kinds.ChatMessage): DeleteFactory {
    return new DeleteFactory((res) => res(blankEventTemplate(kinds.EventDeletion)))
      .channel(channelId, epoch)
      .ms()
      .target(targetId, targetKind);
  }

  /** Points this delete at its target (`e`/`k` tags) */
  target(id: string, kind = 9) {
    return this.chain(includeDeleteTarget(id, kind));
  }
}
