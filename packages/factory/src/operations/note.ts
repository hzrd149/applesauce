import { getNip10References, isPTag } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "nostr-tools";
import { EventPointer } from "nostr-tools/nip19";

import { ensureMarkedEventPointerTag, ensureProfilePointerTag } from "../helpers/common-tags.js";
import { EventOperation } from "../types.js";

/**
 * Includes NIP-10 reply tags
 * @throws {Error} if the parent is not a short text note
 */
export function setThreadParent(parent: NostrEvent): EventOperation {
  if (parent.kind !== kinds.ShortTextNote) throw new Error("Parent must be a short text note");

  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);

    const pointer: EventPointer = { id: parent.id, author: parent.pubkey, kind: parent.kind };
    if (ctx.getEventRelayHint) {
      const hint = await ctx.getEventRelayHint(parent.id);
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

/** Copies "p" tags from parent event and adds new pubkeys */
export function includeNofityTags(parent: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);

    // copy "p" tags from parent event that are not mentions
    for (const tag of parent.tags) {
      if (isPTag(tag) && tag[3] !== "mention") tags.push(tag);
    }

    // add new "p" tag
    const hint = await ctx.getPubkeyRelayHint?.(parent.pubkey);
    tags = ensureProfilePointerTag(tags, { pubkey: parent.pubkey, relays: hint ? [hint] : undefined });

    return { ...draft, tags };
  };
}
