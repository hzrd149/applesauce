import { blueprint } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { setContent } from "applesauce-core/operations/content";
import {
  CREATE_GROUP_KIND,
  CREATE_INVITE_KIND,
  DELETE_EVENT_KIND,
  DELETE_GROUP_KIND,
  EDIT_METADATA_KIND,
  GroupMetadata,
  GroupPointer,
  JOIN_REQUEST_KIND,
  LEAVE_REQUEST_KIND,
  PUT_USER_KIND,
  REMOVE_USER_KIND,
} from "../helpers/groups.js";
import {
  addPreviousRefs,
  setDeleteEventTags,
  setEditMetadataTags,
  setGroupPointer,
  setJoinRequestTags,
  setLeaveRequestTags,
  setPutUserTags,
  setRemoveUserTags,
} from "../operations/group.js";

/** Options for group membership blueprints that support previous references */
export type GroupMembershipOptions = {
  previous?: NostrEvent[];
  reason?: string;
};

/** A blueprint for a NIP-29 join request (kind 9021) */
export function GroupJoinRequestBlueprint(group: GroupPointer, reason?: string, inviteCode?: string) {
  return blueprint(
    JOIN_REQUEST_KIND,
    setGroupPointer(group),
    setJoinRequestTags(group, inviteCode),
    reason ? setContent(reason) : undefined,
  );
}

/** A blueprint for a NIP-29 leave request (kind 9022) */
export function GroupLeaveRequestBlueprint(group: GroupPointer, reason?: string) {
  return blueprint(
    LEAVE_REQUEST_KIND,
    setGroupPointer(group),
    setLeaveRequestTags(group),
    reason ? setContent(reason) : undefined,
  );
}

/** A blueprint for a NIP-29 put user moderation event (kind 9000) */
export function PutUserBlueprint(
  group: GroupPointer,
  pubkey: string,
  roles?: string[],
  options?: GroupMembershipOptions,
) {
  return blueprint(
    PUT_USER_KIND,
    setGroupPointer(group),
    setPutUserTags(pubkey, roles),
    options?.previous && options.previous.length > 0 ? addPreviousRefs(options.previous) : undefined,
    options?.reason ? setContent(options.reason) : undefined,
  );
}

/** A blueprint for a NIP-29 remove user moderation event (kind 9001) */
export function GroupRemoveUserBlueprint(group: GroupPointer, pubkey: string, options?: GroupMembershipOptions) {
  return blueprint(
    REMOVE_USER_KIND,
    setGroupPointer(group),
    setRemoveUserTags(pubkey),
    options?.previous && options.previous.length > 0 ? addPreviousRefs(options.previous) : undefined,
    options?.reason ? setContent(options.reason) : undefined,
  );
}

/** A blueprint for a NIP-29 edit metadata moderation event (kind 9002) */
export function GroupEditMetadataBlueprint(
  group: GroupPointer,
  fields: Partial<GroupMetadata>,
  options?: GroupMembershipOptions,
) {
  return blueprint(
    EDIT_METADATA_KIND,
    setGroupPointer(group),
    setEditMetadataTags(fields),
    options?.previous && options.previous.length > 0 ? addPreviousRefs(options.previous) : undefined,
    options?.reason ? setContent(options.reason) : undefined,
  );
}

/** A blueprint for a NIP-29 delete event moderation event (kind 9005) */
export function GroupDeleteEventBlueprint(group: GroupPointer, eventId: string, options?: GroupMembershipOptions) {
  return blueprint(
    DELETE_EVENT_KIND,
    setGroupPointer(group),
    setDeleteEventTags(eventId),
    options?.previous && options.previous.length > 0 ? addPreviousRefs(options.previous) : undefined,
    options?.reason ? setContent(options.reason) : undefined,
  );
}

/** A blueprint for a NIP-29 create group moderation event (kind 9007) */
export function GroupCreateGroupBlueprint(group: GroupPointer, options?: GroupMembershipOptions) {
  return blueprint(
    CREATE_GROUP_KIND,
    setGroupPointer(group),
    options?.previous && options.previous.length > 0 ? addPreviousRefs(options.previous) : undefined,
    options?.reason ? setContent(options.reason) : undefined,
  );
}

/** A blueprint for a NIP-29 delete group moderation event (kind 9008) */
export function GroupDeleteGroupBlueprint(group: GroupPointer, options?: GroupMembershipOptions) {
  return blueprint(
    DELETE_GROUP_KIND,
    setGroupPointer(group),
    options?.previous && options.previous.length > 0 ? addPreviousRefs(options.previous) : undefined,
    options?.reason ? setContent(options.reason) : undefined,
  );
}

/** A blueprint for a NIP-29 create invite moderation event (kind 9009) */
export function GroupCreateInviteBlueprint(group: GroupPointer, options?: GroupMembershipOptions) {
  return blueprint(
    CREATE_INVITE_KIND,
    setGroupPointer(group),
    options?.previous && options.previous.length > 0 ? addPreviousRefs(options.previous) : undefined,
    options?.reason ? setContent(options.reason) : undefined,
  );
}
