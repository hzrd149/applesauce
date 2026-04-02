import { EventOperation } from "applesauce-core/factories";
import { NostrEvent } from "applesauce-core/helpers/event";
import { ensureMarkedAddressPointerTag } from "applesauce-core/helpers/factory";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";

/**
 * Includes the "a" tag for live streams
 * @param stream - Live stream event
 * @param getRelayHint - Optional function to get relay hint
 */
export function includeLiveStreamTag(
  stream: NostrEvent,
  getRelayHint?: (eventId: string) => Promise<string | undefined>,
): EventOperation {
  return async (draft) => {
    const pointer = getAddressPointerForEvent(stream);
    if (!pointer) throw new Error("Stream is not addressable");

    // add relay hint if there isn't one
    if (pointer.relays?.[0] === undefined && getRelayHint) {
      const hint = await getRelayHint(stream.id);
      if (hint) pointer.relays = [hint];
    }

    return { ...draft, tags: ensureMarkedAddressPointerTag(draft.tags, pointer, "root") };
  };
}
