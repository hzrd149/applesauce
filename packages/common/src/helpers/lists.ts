import {
  getReplaceableIdentifier,
  isAddressableKind,
  isReplaceable,
  isReplaceableKind,
  NostrEvent,
} from "applesauce-core/helpers/event";
import { getHiddenTags } from "applesauce-core/helpers/hidden-tags";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerForEvent,
  getAddressPointerFromATag,
  getEventPointerFromETag,
  getProfilePointerFromPTag,
  getReplaceableAddressFromPointer,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { relaySet } from "applesauce-core/helpers/relays";
import { isATag, isETag, isPTag, processTags } from "applesauce-core/helpers/tags";

export type ReadListTags = "public" | "hidden" | "all";

/** Returns all the tags of a list or set */
export function getListTags(list: NostrEvent, type?: ReadListTags): string[][] {
  switch (type) {
    default:
    case "public":
      return list.tags;
    case "hidden":
      return getHiddenTags(list) ?? [];
    case "all":
      return [...(getHiddenTags(list) ?? []), ...list.tags];
  }
}

/**
 * Checks if an event pointer is anywhere in a list or set
 * NOTE: Ignores the `relay` field in EventPointer
 * @param list - The list or set to check
 * @param pointer - The event pointer to check
 * @param type - Which types of tags to check
 */
export function isEventPointerInList(list: NostrEvent, pointer: string | EventPointer, type?: ReadListTags): boolean {
  const id = typeof pointer === "string" ? pointer : pointer.id;
  const tags = getListTags(list, type);
  return tags.some((t) => t[0] === "e" && t[1] === id);
}

/**
 * Checks if an address pointer is anywhere in a list or set
 * NOTE: Ignores the `relay` field in AddressPointer
 * @param list - The list or set to check
 * @param pointer - The address pointer to check
 * @param type - Which types of tags to check
 */
export function isAddressPointerInList(
  list: NostrEvent,
  pointer: string | AddressPointer,
  type?: ReadListTags,
): boolean {
  const address = typeof pointer === "string" ? pointer : getReplaceableAddressFromPointer(pointer);
  const tags = getListTags(list, type);
  return tags.some((t) => t[0] === "a" && t[1] === address);
}

/**
 * Checks if an profile pointer is anywhere in a list or set
 * NOTE: Ignores the `relay` field in ProfilePointer
 * @param list - The list or set to check
 * @param pointer - The profile pointer to check
 * @param type - Which types of tags to check
 */
export function isProfilePointerInList(
  list: NostrEvent,
  pointer: string | ProfilePointer,
  type?: ReadListTags,
): boolean {
  const pubkey = typeof pointer === "string" ? pointer : pointer.pubkey;
  const tags = getListTags(list, type);
  return tags.some((t) => t[0] === "p" && t[1] === pubkey);
}

/** Returns if an event is in a list */
export function isEventInList(list: NostrEvent, event: NostrEvent): boolean {
  if (isReplaceable(event.kind)) {
    const pointer = getAddressPointerForEvent(event);
    if (pointer && isAddressPointerInList(list, pointer)) return true;
  }

  return isEventPointerInList(list, event.id);
}

/**
 * Returns all the EventPointer in a list or set
 * @param list - The list or set to get the event pointers from
 * @param type - Which types of tags to read
 */
export function getEventPointersFromList(list: NostrEvent, type?: ReadListTags): EventPointer[] {
  return processTags(
    getListTags(list, type),
    (tag) => (isETag(tag) ? tag : undefined),
    (t) => getEventPointerFromETag(t) ?? undefined,
  );
}

/**
 * Returns all the AddressPointer in a list or set
 * @param list - The list or set to get the address pointers from
 * @param type - Which types of tags to read
 */
export function getAddressPointersFromList(list: NostrEvent, type?: ReadListTags): AddressPointer[] {
  return processTags(
    getListTags(list, type),
    (t) => (isATag(t) ? t : undefined),
    (t) => getAddressPointerFromATag(t) ?? undefined,
  );
}

/**
 * Returns all the ProfilePointer in a list or set
 * @param list - The list or set to get the profile pointers from
 * @param type - Which types of tags to read
 */
export function getProfilePointersFromList(list: NostrEvent, type?: ReadListTags): ProfilePointer[] {
  return processTags(
    getListTags(list, type),
    (t) => (isPTag(t) ? t : undefined),
    (t) => getProfilePointerFromPTag(t) ?? undefined,
  );
}

/**
 * Returns a deduplicated array of all 'relay' tags in a list or set
 * @param list - The list or set to get the relays from
 * @param type - Which types of tags to read
 */
export function getRelaysFromList(list: NostrEvent, type?: ReadListTags): string[] {
  return relaySet(processTags(getListTags(list, type), (t) => (t[0] === "relay" ? t[1] : undefined)));
}

/** Returns if an event is a valid list or set */
export function isValidList(event: NostrEvent): boolean {
  try {
    if (isAddressableKind(event.kind)) {
      // event is a set

      // ensure the set has an identifier
      if (!getReplaceableIdentifier(event)) return false;

      return true;
    } else if (isReplaceableKind(event.kind) && event.kind >= 10000 && event.kind < 20000) {
      // event is a list
      return true;
    }
  } catch (error) {}

  return false;
}
