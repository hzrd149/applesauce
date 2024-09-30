import { kinds, NostrEvent } from "nostr-tools";
import { INDEXABLE_TAGS } from "../event-store/common.js";

export const EventUIDSymbol = Symbol.for("event-uid");
export const EventIndexableTagsSymbol = Symbol.for("indexable-tags");
declare module "nostr-tools" {
  export interface Event {
    [EventUIDSymbol]?: string;
    [EventIndexableTagsSymbol]?: Set<string>;
  }
}

/**
 * Returns if a kind is replaceable ( 10000 <= n < 20000 || n == 0 || n == 3 )
 * or parameterized replaceable ( 30000 <= n < 40000 )
 */
export function isReplaceable(kind: number) {
  return kinds.isReplaceableKind(kind) || kinds.isParameterizedReplaceableKind(kind);
}

/**
 * Returns the events Unique ID
 * For normal or ephemeral events this is ( event.id )
 * For replaceable events this is ( event.kind + ":" + event.pubkey )
 * For parametrized replaceable events this is ( event.kind + ":" + event.pubkey + ":" + event.tags.d.1 )
 */
export function getEventUID(event: NostrEvent) {
  let id = event[EventUIDSymbol];

  if (!id) {
    if (isReplaceable(event.kind)) {
      const d = event.tags.find((t) => t[0] === "d")?.[1];
      id = getReplaceableUID(event.kind, event.pubkey, d);
    } else {
      id = event.id;
    }
  }

  return id;
}

export function getReplaceableUID(kind: number, pubkey: string, d?: string) {
  return d ? `${kind}:${pubkey}:${d}` : `${kind}:${pubkey}`;
}

/** Returns a Set of tag names and values that are indexable */
export function getIndexableTags(event: NostrEvent) {
  let indexable = event[EventIndexableTagsSymbol];
  if (!indexable) {
    const tags = new Set<string>();

    for (const tag of event.tags) {
      if (tag[0] && INDEXABLE_TAGS.has(tag[0]) && tag[1]) {
        tags.add(tag[0] + ":" + tag[1]);
      }
    }

    indexable = event[EventIndexableTagsSymbol] = tags;
  }

  return indexable;
}

/** Returns the second index ( tag[1] ) of the first tag that matches the name */
export function getTagValue(event: NostrEvent, name: string) {
  return event.tags.find((t) => t[0] === name)?.[1];
}
