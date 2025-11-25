import { Model } from "applesauce-core/event-store";
import { getReplaceableIdentifier, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { getUserStatusPointer, UserStatusPointer } from "../helpers/user-status.js";

export type UserStatus = UserStatusPointer & {
  event: NostrEvent;
  content: string;
};

/** A model that returns a parsed {@link UserStatus} for a certain type */
export function UserStatusModel(pubkey: string, type: string = "general"): Model<UserStatus | undefined | null> {
  return (events) =>
    events.replaceable(kinds.UserStatuses, pubkey, type).pipe(
      map((event) => {
        if (!event) return undefined;

        const pointer = getUserStatusPointer(event);
        if (!pointer) return null;

        return {
          ...pointer,
          event,
          content: event.content,
        };
      }),
    );
}

/** A model that returns a directory of parsed {@link UserStatus} for a pubkey */
export function UserStatusesModel(pubkey: string): Model<Record<string, UserStatus>> {
  return (events) =>
    events.timeline([{ kinds: [kinds.UserStatuses], authors: [pubkey] }]).pipe(
      map((events) => {
        return events.reduce((dir, event) => {
          try {
            const d = getReplaceableIdentifier(event);
            return { ...dir, [d]: { event, ...getUserStatusPointer(event), content: event.content } };
          } catch (error) {
            return dir;
          }
        }, {});
      }),
    );
}
