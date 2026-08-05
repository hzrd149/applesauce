import { EventOperation } from "applesauce-core/factories";
import { getTagValue, isAddressableKind, NostrEvent, Rumor } from "applesauce-core/helpers/event";
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

/**
 * The event a reaction points to. A full event/rumor carries its tags (so an
 * addressable target can be resolved to an "a" tag), or a lightweight
 * `{ id, pubkey, kind }` pointer for cases where only the identity is known.
 */
export type ReactionParent = NostrEvent | Rumor | { id: string; pubkey: string; kind: number };

/**
 * Includes NIP-25 "e", "p", "k", and "a" tags for a reaction event to point to a parent event
 * @param event - Event being reacted to
 * @param getEventRelayHint - Optional function to get relay hint for event ID
 * @param getPubkeyRelayHint - Optional function to get relay hint for pubkey
 */
export function setReactionParent(
  event: ReactionParent,
  getEventRelayHint?: (eventId: string) => Promise<string | undefined>,
  getPubkeyRelayHint?: (pubkey: string) => Promise<string | undefined>,
): EventOperation {
  return async (draft) => {
    let tags = Array.from(draft.tags);

    const eventHint = getEventRelayHint ? await getEventRelayHint(event.id) : undefined;
    const pubkeyHint = getPubkeyRelayHint ? await getPubkeyRelayHint(event.pubkey) : undefined;

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

    if (isAddressableKind(event.kind) && "tags" in event) {
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
