import { NostrEvent } from "nostr-tools";
import { getHiddenTags } from "./hidden-tags.js";

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
export const INDEXABLE_TAGS = new Set((LETTERS + LETTERS.toUpperCase()).split(""));

export const EventIndexableTagsSymbol = Symbol.for("indexable-tags");

/**
 * Returns the second index ( tag[1] ) of the first tag that matches the name
 * If the event has any hidden tags they will be searched first
 */
export function getTagValue<T extends { kind: number; tags: string[][]; content: string }>(
  event: T,
  name: string,
): string | undefined {
  const hidden = getHiddenTags(event);

  const hiddenValue = hidden?.find((t) => t[0] === name)?.[1];
  if (hiddenValue) return hiddenValue;
  return event.tags.find((t) => t[0] === name)?.[1];
}

/** Checks if an event has a public name / value tag*/
export function hasNameValueTag<T extends { kind: number; tags: string[][]; content: string }>(
  event: T,
  name: string,
  value: string,
): boolean {
  return event.tags.some((t) => t[0] === name && t[1] === value);
}

/** Returns a Set of tag names and values that are indexable */
export function getIndexableTags(event: NostrEvent): Set<string> {
  let indexable = Reflect.get(event, EventIndexableTagsSymbol) as Set<string> | undefined;
  if (!indexable) {
    const tags = new Set<string>();

    for (const tag of event.tags) {
      if (tag.length >= 2 && tag[0].length === 1 && INDEXABLE_TAGS.has(tag[0])) {
        tags.add(tag[0] + ":" + tag[1]);
      }
    }

    indexable = tags;
    Reflect.set(event, EventIndexableTagsSymbol, tags);
  }

  return indexable;
}
