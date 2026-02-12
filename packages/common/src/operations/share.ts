import { EventOperation } from "applesauce-core/event-factory";
import { isAddressableKind, kinds, NostrEvent } from "applesauce-core/helpers/event";
import {
  ensureAddressPointerTag,
  ensureEventPointerTag,
  ensureKTag,
  ensureProfilePointerTag,
} from "applesauce-core/helpers/factory";
import { getAddressPointerForEvent, getEventPointerForEvent } from "applesauce-core/helpers/pointers";
import { setContent } from "applesauce-core/operations/content";

// TODO: some of these operations should be refactored to use "modifyPublicTags"

/**
 * Includes NIP-18 repost tags
 * @param event - Event being shared/reposted
 * @param getEventRelayHint - Optional function to get relay hint for event ID
 * @param getPubkeyRelayHint - Optional function to get relay hint for pubkey
 */
export function setShareTags(
  event: NostrEvent,
  getEventRelayHint?: (eventId: string) => Promise<string | undefined>,
  getPubkeyRelayHint?: (pubkey: string) => Promise<string | undefined>,
): EventOperation {
  return async (draft) => {
    let tags = Array.from(draft.tags);

    const hint = getEventRelayHint ? await getEventRelayHint(event.id) : undefined;

    // add "e" tag
    tags = ensureEventPointerTag(tags, getEventPointerForEvent(event, hint ? [hint] : undefined));

    // add "a" tag
    if (isAddressableKind(event.kind)) {
      const pointer = getAddressPointerForEvent(event, hint ? [hint] : undefined);
      if (pointer) tags = ensureAddressPointerTag(tags, pointer);
    }

    // add "p" tag for notify
    const pubkeyHint = getPubkeyRelayHint ? await getPubkeyRelayHint(event.pubkey) : undefined;
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
