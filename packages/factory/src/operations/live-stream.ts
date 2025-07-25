import { NostrEvent } from "nostr-tools";
import { getAddressPointerForEvent } from "applesauce-core/helpers";

import { EventOperation } from "../types.js";
import { ensureMarkedAddressPointerTag } from "../helpers/common-tags.js";

/** Includes the "a" tag for live streams */
export function includeLiveStreamTag(stream: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);
    const hint = await ctx.getEventRelayHint?.(stream.id);
    tags = ensureMarkedAddressPointerTag(tags, getAddressPointerForEvent(stream, hint ? [hint] : undefined), "root");
    return { ...draft, tags };
  };
}
