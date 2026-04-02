import { EventOperation } from "applesauce-core/factories";
import { isEvent, type NostrEvent } from "applesauce-core/helpers/event";
import { createATagFromAddressPointer, createETagFromEventPointer } from "applesauce-core/helpers/factory";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  getAddressPointerFromATag,
  getEventPointerForEvent,
  getEventPointerFromETag,
  getReplaceableAddressFromPointer,
  normalizeToAddressPointer,
  normalizeToEventPointer,
} from "applesauce-core/helpers/pointers";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { isValidBadgeAward } from "../helpers/badge-award.js";
import { isValidBadge } from "../helpers/badge.js";
import type { ProfileBadgeSlot } from "../helpers/profile-badges.js";

export type ProfileBadgeSlotInput = {
  badge: AddressPointer | NostrEvent | string;
  award: EventPointer | NostrEvent | string;
};

/** Normalizes a profile badge slot input to a profile badge slot */
function normalizeSlot(input: ProfileBadgeSlotInput): ProfileBadgeSlot {
  const badgePointer =
    typeof input.badge === "string"
      ? normalizeToAddressPointer(input.badge)
      : isEvent(input.badge)
        ? isValidBadge(input.badge)
          ? getAddressPointerForEvent(input.badge)
          : undefined
        : input.badge;
  if (!badgePointer) throw new Error("Invalid badge pointer provided");

  const awardPointer =
    typeof input.award === "string"
      ? normalizeToEventPointer(input.award)
      : isEvent(input.award)
        ? isValidBadgeAward(input.award)
          ? getEventPointerForEvent(input.award)
          : undefined
        : input.award;
  if (!awardPointer) throw new Error("Invalid award pointer provided");

  return { badge: badgePointer, award: awardPointer };
}

/** Encodes a profile badge slot to a list of tags */
function encodeSlot(slot: ProfileBadgeSlot): string[][] {
  return [createATagFromAddressPointer(slot.badge), createETagFromEventPointer(slot.award)];
}

/** Removes slot pairs from a list of tags */
function removeSlotPairs(tags: string[][], predicate?: (slot: ProfileBadgeSlot) => boolean): string[][] {
  const result: string[][] = [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (tag[0] === "a" && i + 1 < tags.length && tags[i + 1][0] === "e") {
      const next = tags[i + 1];
      const badge = getAddressPointerFromATag(tag);
      const award = getEventPointerFromETag(next);
      const slot = badge && award ? { badge, award } : undefined;
      const shouldRemove = predicate ? (slot ? predicate(slot) : false) : true;
      if (shouldRemove) {
        i += 1;
        continue;
      }
      result.push(tag, next);
      i += 1;
      continue;
    }
    result.push(tag);
  }
  return result;
}

function sameBadge(a: AddressPointer, b: AddressPointer): boolean {
  return getReplaceableAddressFromPointer(a) === getReplaceableAddressFromPointer(b);
}

function sameAward(a: EventPointer, b: EventPointer): boolean {
  return a.id === b.id;
}

/** Returns the tag-index ranges [start, start+2) for each slot pair */
function getSlotRanges(tags: string[][]): Array<[start: number, end: number]> {
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < tags.length; i++) {
    if (tags[i][0] === "a" && i + 1 < tags.length && tags[i + 1][0] === "e") {
      ranges.push([i, i + 2]);
      i += 1;
    }
  }
  return ranges;
}

/** Replaces every badge slot with the provided list */
export function setSlots(slots: Array<ProfileBadgeSlotInput | ProfileBadgeSlot>): EventOperation {
  const normalized = slots.map(normalizeSlot);
  return modifyPublicTags((tags) => {
    const remaining = removeSlotPairs(tags);
    const newTags = normalized.flatMap((slot) => encodeSlot(slot));
    return [...remaining, ...newTags];
  });
}

/** Adds a slot, replacing any existing slot for the same badge */
export function addSlot(slot: ProfileBadgeSlotInput | ProfileBadgeSlot): EventOperation {
  const normalized = normalizeSlot(slot);
  return modifyPublicTags((tags) => {
    const filtered = removeSlotPairs(tags, (existing) => sameBadge(existing.badge, normalized.badge));
    return [...filtered, ...encodeSlot(normalized)];
  });
}

/** Removes every slot */
export function clearSlots(): EventOperation {
  return modifyPublicTags((tags) => removeSlotPairs(tags));
}

/** Removes the slot associated with a specific badge definition */
export function removeSlotByBadge(badge: AddressPointer | NostrEvent | string): EventOperation {
  let pointer: AddressPointer | null = null;
  if (typeof badge === "string") pointer = normalizeToAddressPointer(badge);
  else if (isEvent(badge)) pointer = isValidBadge(badge) ? getAddressPointerForEvent(badge) : null;
  else pointer = badge;

  if (!pointer) throw new Error("Invalid badge pointer provided");

  return modifyPublicTags((tags) => removeSlotPairs(tags, (slot) => sameBadge(slot.badge, pointer!)));
}

/** Removes the slot referencing a specific award receipt */
export function removeSlotByAward(award: EventPointer | NostrEvent | string): EventOperation {
  let pointer: EventPointer | null = null;
  if (typeof award === "string") pointer = normalizeToEventPointer(award);
  else if (isEvent(award)) pointer = isValidBadgeAward(award) ? getEventPointerForEvent(award) : null;
  else pointer = award;

  if (!pointer) throw new Error("Invalid award pointer provided");

  return modifyPublicTags((tags) => removeSlotPairs(tags, (slot) => sameAward(slot.award, pointer!)));
}

/** Inserts a slot at a specific position among existing slots */
export function insertSlot(index: number, slot: ProfileBadgeSlotInput | ProfileBadgeSlot): EventOperation {
  const normalized = normalizeSlot(slot);
  return modifyPublicTags((tags) => {
    const ranges = getSlotRanges(tags);
    const encoded = encodeSlot(normalized);

    if (ranges.length === 0 || index >= ranges.length) return [...tags, ...encoded];

    const insertAt = ranges[Math.max(0, index)][0];
    return [...tags.slice(0, insertAt), ...encoded, ...tags.slice(insertAt)];
  });
}

/** Inserts a slot at the beginning */
export function prependSlot(slot: ProfileBadgeSlotInput | ProfileBadgeSlot): EventOperation {
  return insertSlot(0, slot);
}

/** Inserts a slot at the end */
export function appendSlot(slot: ProfileBadgeSlotInput | ProfileBadgeSlot): EventOperation {
  return insertSlot(Infinity, slot);
}

/** Replaces the slot at a specific position with a new one */
export function setSlot(index: number, slot: ProfileBadgeSlotInput | ProfileBadgeSlot): EventOperation {
  const normalized = normalizeSlot(slot);
  return modifyPublicTags((tags) => {
    const ranges = getSlotRanges(tags);
    if (index < 0 || index >= ranges.length) throw new Error(`Slot index ${index} out of range`);

    const [start, end] = ranges[index];
    return [...tags.slice(0, start), ...encodeSlot(normalized), ...tags.slice(end)];
  });
}
