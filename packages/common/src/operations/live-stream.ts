import { EventOperation } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { ensureMarkedAddressPointerTag } from "applesauce-core/helpers/factory";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";

/** Includes the "a" tag for live streams */
export function includeLiveStreamTag(stream: NostrEvent): EventOperation {
  return async (draft, ctx) => {
    const pointer = getAddressPointerForEvent(stream);
    if (!pointer) throw new Error("Stream is not addressable");

    // add relay hint if there isn't one
    if (pointer.relays?.[0] === undefined && ctx?.getEventRelayHint) {
      const hint = await ctx.getEventRelayHint(stream.id);
      if (hint) pointer.relays = [hint];
    }

    return { ...draft, tags: ensureMarkedAddressPointerTag(draft.tags, pointer, "root") };
  };
}
