import { EventOperation } from "applesauce-core/event-factory";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { ensureMarkedEventPointerTag, ensureProfilePointerTag } from "applesauce-core/helpers/factory";
import { EventPointer } from "applesauce-core/helpers/pointers";
import { isPTag } from "applesauce-core/helpers/tags";
import { getNip10References } from "../helpers/threading.js";

/**
 * Includes NIP-10 reply tags
 * @param parent - Parent event to reply to
 * @param getRelayHint - Optional function to get relay hint for event ID
 * @throws {Error} if the parent is not a short text note
 */
export function setThreadParent(
  parent: NostrEvent,
  getRelayHint?: (eventId: string) => Promise<string | undefined>,
): EventOperation {
  if (parent.kind !== kinds.ShortTextNote) throw new Error("Parent must be a short text note");

  return async (draft) => {
    let tags = Array.from(draft.tags);

    const pointer: EventPointer = { id: parent.id, author: parent.pubkey, kind: parent.kind };
    if (getRelayHint) {
      const hint = await getRelayHint(parent.id);
      if (hint) pointer.relays = [hint];
    }

    const refs = getNip10References(parent);
    const root = refs.root?.e ?? pointer;

    const reply: EventPointer = pointer;

    tags = ensureMarkedEventPointerTag(tags, root, "root");
    tags = ensureMarkedEventPointerTag(tags, reply, "reply");

    return { ...draft, tags };
  };
}

/**
 * Copies "p" tags from parent event and adds new pubkeys
 * @param parent - Parent event to copy p tags from
 * @param getRelayHint - Optional function to get relay hint for pubkey
 */
export function includePubkeyNotificationTags(
  parent: NostrEvent,
  getRelayHint?: (pubkey: string) => Promise<string | undefined>,
): EventOperation {
  return async (draft) => {
    let tags = Array.from(draft.tags);

    // copy "p" tags from parent event that are not mentions
    for (const tag of parent.tags) {
      if (isPTag(tag) && tag[3] !== "mention") tags.push(tag);
    }

    // add new "p" tag
    const hint = getRelayHint ? await getRelayHint(parent.pubkey) : undefined;
    tags = ensureProfilePointerTag(tags, { pubkey: parent.pubkey, relays: hint ? [hint] : undefined });

    return { ...draft, tags };
  };
}
