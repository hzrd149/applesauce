import { EventOperation } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { ensureMarkedAddressPointerTag } from "applesauce-core/helpers/factory";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";

/** Includes the "a" tag for live streams */
export function includeLiveStreamTag(stream: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);
    const hint = await ctx.getEventRelayHint?.(stream.id);
    tags = ensureMarkedAddressPointerTag(tags, getAddressPointerForEvent(stream, hint ? [hint] : undefined), "root");
    return { ...draft, tags };
  };
}
