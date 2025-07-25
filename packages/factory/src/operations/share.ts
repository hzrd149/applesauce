import { getAddressPointerForEvent, getEventPointerForEvent } from "applesauce-core/helpers";
import { kinds, NostrEvent } from "nostr-tools";
import { isAddressableKind } from "nostr-tools/kinds";

import {
  ensureAddressPointerTag,
  ensureEventPointerTag,
  ensureKTag,
  ensureProfilePointerTag,
} from "../helpers/common-tags.js";
import { EventOperation } from "../types.js";
import { setContent } from "./content.js";

// TODO: some of these operations should be refactored to use "modifyPublicTags"

/** Includes NIP-18 repost tags */
export function setShareTags(event: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);

    const hint = await ctx.getEventRelayHint?.(event.id);

    // add "e" tag
    tags = ensureEventPointerTag(tags, getEventPointerForEvent(event, hint ? [hint] : undefined));

    // add "a" tag
    if (isAddressableKind(event.kind)) {
      tags = ensureAddressPointerTag(tags, getAddressPointerForEvent(event, hint ? [hint] : undefined));
    }

    // add "p" tag for notify
    const pubkeyHint = await ctx.getPubkeyRelayHint?.(event.pubkey);
    tags = ensureProfilePointerTag(tags, { pubkey: event.pubkey, relays: pubkeyHint ? [pubkeyHint] : undefined });

    // add "k" tag
    tags = ensureKTag(tags, event.kind);

    return { ...draft, tags };
  };
}

/** Sets the NIP-18 repost kind based on the kind of event being shared */
export function setShareKind(event: NostrEvent): EventOperation {
  return (draft) => {
    return { ...draft, kind: event.kind === kinds.ShortTextNote ? kinds.Repost : kinds.GenericRepost };
  };
}

/** Sets the content of the event to a JSON string of the shared event */
export function embedSharedEvent(event: NostrEvent): EventOperation {
  return setContent(JSON.stringify(event));
}
