import { Model } from "applesauce-core/event-store";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import {
  getUserStatusPointer,
  getUserStatusType,
  isUserStatusCleared,
  isValidUserStatus,
  UserStatusPointer,
} from "../helpers/user-status.js";

/** A parsed user status, the pointer fields are only set when the status links to something */
export type UserStatus = (UserStatusPointer | { type?: undefined; data?: undefined }) & {
  event: NostrEvent;
  content: string;
};

function parseUserStatus(event: NostrEvent): UserStatus {
  return { ...getUserStatusPointer(event), event, content: event.content };
}

/** A model that returns a parsed {@link UserStatus} for a certain type, or undefined when missing or cleared */
export function UserStatusModel(pubkey: string, type: string = "general"): Model<UserStatus | undefined> {
  return (events) =>
    events.replaceable(kinds.UserStatuses, pubkey, type).pipe(
      map((event) => {
        if (!event || !isValidUserStatus(event) || isUserStatusCleared(event)) return undefined;
        return parseUserStatus(event);
      }),
    );
}

/** A model that returns a directory of parsed {@link UserStatus} for a pubkey, excluding cleared statuses */
export function UserStatusesModel(pubkey: string): Model<Record<string, UserStatus>> {
  return (events) =>
    events.timeline([{ kinds: [kinds.UserStatuses], authors: [pubkey] }]).pipe(
      map((events) => {
        const dir: Record<string, UserStatus> = {};
        for (const event of events) {
          if (!isValidUserStatus(event) || isUserStatusCleared(event)) continue;
          dir[getUserStatusType(event)] = parseUserStatus(event);
        }
        return dir;
      }),
    );
}
