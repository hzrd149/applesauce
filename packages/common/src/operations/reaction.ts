import { EventOperation } from "applesauce-core/event-factory";
import { getTagValue, isAddressableKind, NostrEvent } from "applesauce-core/helpers/event";
import {
  ensureAddressPointerTag,
  ensureEventPointerTag,
  ensureKTag,
  ensureProfilePointerTag,
} from "applesauce-core/helpers/factory";
import { Emoji } from "../helpers/emoji.js";

// TODO: some of these operations should be refactored to use "modifyPublicTags"

/** Sets the content for a reaction event */
export function setReaction(emoji: string | Emoji = "+"): EventOperation {
  return (draft) => ({ ...draft, content: typeof emoji === "string" ? emoji : `:${emoji.shortcode}:` });
}

/** Includes NIP-25 "e", "p", "k", and "a" tags for a reaction event to point to a parent event */
export function setReactionParent(event: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);

    const eventHint = await ctx?.getEventRelayHint?.(event.id);
    const pubkeyHint = await ctx?.getPubkeyRelayHint?.(event.pubkey);

    // include "e" tag
    tags = ensureEventPointerTag(tags, {
      id: event.id,
      relays: eventHint ? [eventHint] : undefined,
    });

    // include "p" tag
    tags = ensureProfilePointerTag(tags, {
      pubkey: event.pubkey,
      relays: pubkeyHint ? [pubkeyHint] : undefined,
    });

    if (isAddressableKind(event.kind)) {
      // include "a" tag
      const identifier = getTagValue(event, "d");
      if (identifier)
        tags = ensureAddressPointerTag(tags, {
          kind: event.kind,
          pubkey: event.pubkey,
          identifier,
          relays: eventHint ? [eventHint] : undefined,
        });
    }

    // include "k" tag
    tags = ensureKTag(tags, event.kind);

    return { ...draft, tags };
  };
}
