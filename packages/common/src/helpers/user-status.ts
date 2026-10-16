import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getReplaceableIdentifier, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
  getProfilePointerFromPTag,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";

/** The event kind for NIP-38 user statuses */
export const USER_STATUS_KIND = kinds.UserStatuses;

/** A NIP-38 user status event */
export type UserStatusEvent = KnownEvent<typeof kinds.UserStatuses>;

/** The type of a user status, `general` and `music` are defined by NIP-38 */
export type UserStatusType = "general" | "music" | (string & {});

export const UserStatusPointerSymbol = Symbol.for("user-status-pointer");

export type UserStatusPointer =
  | { type: "nevent"; data: EventPointer }
  | { type: "nprofile"; data: ProfilePointer }
  | { type: "naddr"; data: AddressPointer }
  | { type: "url"; data: string };

function getStatusPointer(status: NostrEvent): UserStatusPointer | null {
  const pTag = status.tags.find((t) => t[0] === "p" && t[1]);
  if (pTag) {
    const pointer = getProfilePointerFromPTag(pTag);
    if (pointer) return { type: "nprofile", data: pointer };
  }

  const eTag = status.tags.find((t) => t[0] === "e" && t[1]);
  if (eTag) {
    const pointer = getEventPointerFromETag(eTag);
    if (pointer) return { type: "nevent", data: pointer };
  }

  const aTag = status.tags.find((t) => t[0] === "a" && t[1]);
  if (aTag) {
    const pointer = getAddressPointerFromATag(aTag);
    if (pointer) return { type: "naddr", data: pointer };
  }

  const rTag = status.tags.find((t) => t[0] === "r" && t[1]);
  if (rTag) return { type: "url", data: rTag[1] };

  return null;
}

/** Checks if an event is a valid NIP-38 user status */
export function isValidUserStatus(event?: NostrEvent): event is UserStatusEvent {
  return !!event && event.kind === kinds.UserStatuses && event.tags.some((t) => t[0] === "d");
}

/** Gets the status type (the "d" tag) of a user status event */
export function getUserStatusType(status: NostrEvent): UserStatusType {
  return getReplaceableIdentifier(status);
}

/** Checks if a user status has been cleared (empty content) */
export function isUserStatusCleared(status: NostrEvent): boolean {
  return status.content.trim() === "";
}

/** Gets the {@link UserStatusPointer} for a status event */
export function getUserStatusPointer(status: NostrEvent) {
  return getOrComputeCachedValue(status, UserStatusPointerSymbol, () => getStatusPointer(status));
}
