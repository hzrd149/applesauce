import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getReplaceableIdentifier, getTagValue, NostrEvent } from "applesauce-core/helpers/event";
import { getHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { processTags } from "applesauce-core/helpers/tags";
import { normalizeURL } from "applesauce-core/helpers/url";

export const GROUPS_LIST_KIND = 10009;
export const GROUP_MESSAGE_KIND = 9;

// NIP-29 Group event kinds
export const GROUP_METADATA_KIND = 39000;
export const GROUP_ADMINS_KIND = 39001;
export const GROUP_MEMBERS_KIND = 39002;
export const GROUP_ROLES_KIND = 39003;
export const JOIN_REQUEST_KIND = 9021;
export const LEAVE_REQUEST_KIND = 9022;
export const PUT_USER_KIND = 9000;
export const REMOVE_USER_KIND = 9001;
export const EDIT_METADATA_KIND = 9002;
export const DELETE_EVENT_KIND = 9005;
export const CREATE_GROUP_KIND = 9007;
export const DELETE_GROUP_KIND = 9008;
export const CREATE_INVITE_KIND = 9009;

/** NIP-29 group pointer */
export type GroupPointer = {
  /** the id of the group */
  id: string;
  /** The url to the relay with wss:// or ws:// protocol */
  relay: string;
  /** The name of the group */
  name?: string;
};

/** decodes a group identifier into a group pointer object */
export function decodeGroupPointer(str: string): GroupPointer | null {
  let [relay, id] = str.split("'");
  if (!relay) return null;

  // Prepend wss:// if missing
  if (!relay.match(/^wss?:/)) relay = `wss://${relay}`;

  // Normalize the relay url
  relay = normalizeURL(relay);

  return { relay, id: id || "_" };
}

/** Converts a group pointer into a group identifier */
export function encodeGroupPointer(pointer: GroupPointer): string {
  const hostname = URL.canParse(pointer.relay) ? new URL(pointer.relay).hostname : pointer.relay;

  return `${hostname}'${pointer.id}`;
}

export const GroupsPublicSymbol = Symbol.for("groups-public");
export const GroupsHiddenSymbol = Symbol.for("groups-hidden");

/** gets a {@link GroupPointer} from a "h" tag if it has a relay hint */
export function getGroupPointerFromHTag(tag: string[], hint?: string): GroupPointer | undefined {
  let [_, id, relay] = tag as [string, string, string?];
  if (!relay && hint) relay = hint;
  if (!id || !relay) return undefined;
  return { id, relay };
}

/** gets a {@link GroupPointer} from a "group" tag */
export function getGroupPointerFromGroupTag(tag: string[]): GroupPointer {
  const [_, id, relay, name] = tag;
  return { id, relay, name };
}

/** Returns all the public groups from a k:10009 list */
export function getPublicGroups(bookmark: NostrEvent): GroupPointer[] {
  return getOrComputeCachedValue(bookmark, GroupsPublicSymbol, () =>
    processTags(
      bookmark.tags.filter((t) => t[0] === "group"),
      getGroupPointerFromGroupTag,
    ),
  );
}

/** Returns all the hidden groups from a k:10009 list */
export function getHiddenGroups(bookmark: NostrEvent): GroupPointer[] | undefined {
  return getOrComputeCachedValue(bookmark, GroupsHiddenSymbol, () => {
    const tags = getHiddenTags(bookmark);
    return (
      tags &&
      processTags(
        bookmark.tags.filter((t) => t[0] === "group"),
        getGroupPointerFromGroupTag,
      )
    );
  });
}

/** Gets a {@link GroupPointer} from a group event by reading the "h" tag */
export function getGroupPointer(event: NostrEvent, relay?: string): GroupPointer | undefined {
  const hTag = event.tags.find((t) => t[0] === "h");
  if (!hTag) return undefined;
  return getGroupPointerFromHTag(hTag, relay);
}

/** Gets the group id from a group event by reading the "h" tag */
export function getGroupId(event: NostrEvent): string | undefined {
  const hTag = event.tags.find((t) => t[0] === "h");
  if (!hTag) return undefined;
  return hTag[1];
}

/** Gets a {@link GroupPointer} from a kind 39000 group metadata event */
export function getGroupPointerFromMetadata(event: NostrEvent, relay: string): GroupPointer | undefined {
  // Use the "d" tag for the group ID and the provided relay
  const groupId = getReplaceableIdentifier(event) || "_";
  const name = getTagValue(event, "name");

  return {
    id: groupId,
    relay: relay,
    name: name,
  };
}

// Type definitions for NIP-29 group structures

/** Group metadata structure from kind 39000 */
export type GroupMetadata = {
  id: string;
  name?: string;
  picture?: string;
  about?: string;
  isPublic: boolean;
  isPrivate: boolean;
  isOpen: boolean;
  isClosed: boolean;
};

/** Group admin with roles from kind 39001 */
export type GroupAdmin = {
  pubkey: string;
  roles: string[];
};

/** Group role definition from kind 39003 */
export type GroupRole = {
  name: string;
  description?: string;
};

/** Join request event information (kind 9021) */
export type GroupJoinRequestInfo = {
  groupId: string;
  reason?: string;
  inviteCode?: string;
};

/** Leave request event information (kind 9022) */
export type GroupLeaveRequestInfo = {
  groupId: string;
  reason?: string;
};

/** Put user event information (kind 9000) */
export type GroupPutUserInfo = {
  groupId: string;
  pubkey: string;
  roles?: string[];
  reason?: string;
};

/** Remove user event information (kind 9001) */
export type GroupRemoveUserInfo = {
  groupId: string;
  pubkey: string;
  reason?: string;
};

/** Edit metadata event information (kind 9002) */
export type GroupEditMetadataInfo = {
  groupId: string;
  metadataFields: Partial<GroupMetadata>;
  reason?: string;
};

/** Delete event information (kind 9005) */
export type GroupDeleteEventInfo = {
  groupId: string;
  eventId: string;
  reason?: string;
};

/** Create group event information (kind 9007) */
export type GroupCreateGroupInfo = {
  groupId: string;
  reason?: string;
};

/** Delete group event information (kind 9008) */
export type GroupDeleteGroupInfo = {
  groupId: string;
  reason?: string;
};

/** Create invite event information (kind 9009) */
export type GroupCreateInviteInfo = {
  groupId: string;
  reason?: string;
};

// Symbols for caching parsed data
const GroupMetadataSymbol = Symbol.for("group-metadata");
const GroupAdminsSymbol = Symbol.for("group-admins");
const GroupMembersSymbol = Symbol.for("group-members");
const GroupRolesSymbol = Symbol.for("group-roles");
const JoinRequestSymbol = Symbol.for("join-request");
const LeaveRequestSymbol = Symbol.for("leave-request");
const PutUserSymbol = Symbol.for("put-user");
const RemoveUserSymbol = Symbol.for("remove-user");
const EditMetadataSymbol = Symbol.for("edit-metadata");
const DeleteEventSymbol = Symbol.for("delete-event");
const CreateGroupSymbol = Symbol.for("create-group");
const DeleteGroupSymbol = Symbol.for("delete-group");
const CreateInviteSymbol = Symbol.for("create-invite");

/** Gets group metadata from a kind 39000 event */
export function getGroupMetadata(event: NostrEvent): GroupMetadata | undefined {
  if (event.kind !== GROUP_METADATA_KIND) return undefined;

  return getOrComputeCachedValue(event, GroupMetadataSymbol, () => {
    const id = getReplaceableIdentifier(event) || "_";
    const name = getTagValue(event, "name");
    const picture = getTagValue(event, "picture");
    const about = getTagValue(event, "about");

    const publicTag = event.tags.find((t) => t[0] === "public");
    const privateTag = event.tags.find((t) => t[0] === "private");
    const openTag = event.tags.find((t) => t[0] === "open");
    const closedTag = event.tags.find((t) => t[0] === "closed");

    return {
      id,
      name,
      picture,
      about,
      isPublic: !!publicTag,
      isPrivate: !!privateTag,
      isOpen: !!openTag,
      isClosed: !!closedTag,
    };
  });
}

/** Gets group admins from a kind 39001 event */
export function getGroupAdmins(event: NostrEvent): GroupAdmin[] | undefined {
  if (event.kind !== GROUP_ADMINS_KIND) return undefined;

  return getOrComputeCachedValue(event, GroupAdminsSymbol, () => {
    const adminsMap = new Map<string, string[]>();

    for (const tag of event.tags) {
      if (tag[0] === "p" && tag[1]) {
        const pubkey = tag[1];
        const roles = tag.slice(2).filter((r) => r.length > 0);

        if (adminsMap.has(pubkey)) {
          const existingRoles = adminsMap.get(pubkey)!;
          adminsMap.set(pubkey, [...new Set([...existingRoles, ...roles])]);
        } else {
          adminsMap.set(pubkey, roles);
        }
      }
    }

    return Array.from(adminsMap.entries()).map(([pubkey, roles]) => ({
      pubkey,
      roles,
    }));
  });
}

/** Gets group members from a kind 39002 event */
export function getGroupMembers(event: NostrEvent): string[] | undefined {
  if (event.kind !== GROUP_MEMBERS_KIND) return undefined;

  return getOrComputeCachedValue(event, GroupMembersSymbol, () => {
    return event.tags.filter((t) => t[0] === "p" && t[1]).map((t) => t[1]);
  });
}

/** Gets group roles from a kind 39003 event */
export function getGroupRoles(event: NostrEvent): GroupRole[] | undefined {
  if (event.kind !== GROUP_ROLES_KIND) return undefined;

  return getOrComputeCachedValue(event, GroupRolesSymbol, () => {
    return event.tags
      .filter((t) => t[0] === "role" && t[1])
      .map((t) => ({
        name: t[1],
        description: t[2],
      }));
  });
}

/** Gets join request information from a kind 9021 event */
export function getGroupJoinRequestInfo(event: NostrEvent): GroupJoinRequestInfo | undefined {
  if (event.kind !== JOIN_REQUEST_KIND) return undefined;

  return getOrComputeCachedValue(event, JoinRequestSymbol, () => {
    const groupId = getGroupId(event);
    if (!groupId) return undefined;

    return {
      groupId,
      reason: event.content || undefined,
      inviteCode: getTagValue(event, "code"),
    };
  });
}

/** Gets leave request information from a kind 9022 event */
export function getGroupLeaveRequestInfo(event: NostrEvent): GroupLeaveRequestInfo | undefined {
  if (event.kind !== LEAVE_REQUEST_KIND) return undefined;

  return getOrComputeCachedValue(event, LeaveRequestSymbol, () => {
    const groupId = getGroupId(event);
    if (!groupId) return undefined;

    return {
      groupId,
      reason: event.content || undefined,
    };
  });
}

/** Gets put user event information from a kind 9000 event */
export function getGroupPutUserInfo(event: NostrEvent): GroupPutUserInfo | undefined {
  if (event.kind !== PUT_USER_KIND) return undefined;

  return getOrComputeCachedValue(event, PutUserSymbol, () => {
    const groupId = getGroupId(event);
    const pubkey = getTagValue(event, "p");
    if (!groupId || !pubkey) return undefined;

    const roles = event.tags.filter((t) => t[0] === "p" && t.length > 2).flatMap((t) => t.slice(2));

    return {
      groupId,
      pubkey,
      roles: roles.length > 0 ? roles : undefined,
      reason: event.content || undefined,
    };
  });
}

/** Gets remove user event information from a kind 9001 event */
export function getGroupRemoveUserInfo(event: NostrEvent): GroupRemoveUserInfo | undefined {
  if (event.kind !== REMOVE_USER_KIND) return undefined;

  return getOrComputeCachedValue(event, RemoveUserSymbol, () => {
    const groupId = getGroupId(event);
    const pubkey = getTagValue(event, "p");
    if (!groupId || !pubkey) return undefined;

    return {
      groupId,
      pubkey,
      reason: event.content || undefined,
    };
  });
}

/** Gets edit metadata event information from a kind 9002 event */
export function getGroupEditMetadataInfo(event: NostrEvent): GroupEditMetadataInfo | undefined {
  if (event.kind !== EDIT_METADATA_KIND) return undefined;

  return getOrComputeCachedValue(event, EditMetadataSymbol, () => {
    const groupId = getGroupId(event);
    if (!groupId) return undefined;

    const metadataFields: Partial<GroupMetadata> = {};
    const name = getTagValue(event, "name");
    const picture = getTagValue(event, "picture");
    const about = getTagValue(event, "about");
    const publicTag = event.tags.find((t) => t[0] === "public");
    const privateTag = event.tags.find((t) => t[0] === "private");
    const openTag = event.tags.find((t) => t[0] === "open");
    const closedTag = event.tags.find((t) => t[0] === "closed");

    if (name !== undefined) metadataFields.name = name;
    if (picture !== undefined) metadataFields.picture = picture;
    if (about !== undefined) metadataFields.about = about;
    if (publicTag) metadataFields.isPublic = true;
    if (privateTag) metadataFields.isPrivate = true;
    if (openTag) metadataFields.isOpen = true;
    if (closedTag) metadataFields.isClosed = true;

    return {
      groupId,
      metadataFields,
      reason: event.content || undefined,
    };
  });
}

/** Gets delete event information from a kind 9005 event */
export function getGroupDeleteEventInfo(event: NostrEvent): GroupDeleteEventInfo | undefined {
  if (event.kind !== DELETE_EVENT_KIND) return undefined;

  return getOrComputeCachedValue(event, DeleteEventSymbol, () => {
    const groupId = getGroupId(event);
    const eventId = getTagValue(event, "e");
    if (!groupId || !eventId) return undefined;

    return {
      groupId,
      eventId,
      reason: event.content || undefined,
    };
  });
}

/** Gets create group event information from a kind 9007 event */
export function getGroupCreateGroupInfo(event: NostrEvent): GroupCreateGroupInfo | undefined {
  if (event.kind !== CREATE_GROUP_KIND) return undefined;

  return getOrComputeCachedValue(event, CreateGroupSymbol, () => {
    const groupId = getGroupId(event);
    if (!groupId) return undefined;

    return {
      groupId,
      reason: event.content || undefined,
    };
  });
}

/** Gets delete group event information from a kind 9008 event */
export function getGroupDeleteGroupInfo(event: NostrEvent): GroupDeleteGroupInfo | undefined {
  if (event.kind !== DELETE_GROUP_KIND) return undefined;

  return getOrComputeCachedValue(event, DeleteGroupSymbol, () => {
    const groupId = getGroupId(event);
    if (!groupId) return undefined;

    return {
      groupId,
      reason: event.content || undefined,
    };
  });
}

/** Gets create invite event information from a kind 9009 event */
export function getGroupCreateInviteInfo(event: NostrEvent): GroupCreateInviteInfo | undefined {
  if (event.kind !== CREATE_INVITE_KIND) return undefined;

  return getOrComputeCachedValue(event, CreateInviteSymbol, () => {
    const groupId = getGroupId(event);
    if (!groupId) return undefined;

    return {
      groupId,
      reason: event.content || undefined,
    };
  });
}

/** Checks group membership status from kind 9000/9001 events */
export function checkGroupMembership(events: NostrEvent[], pubkey: string): boolean | undefined {
  // Filter to only membership-related events
  const membershipEvents = events.filter(
    (e) => (e.kind === PUT_USER_KIND || e.kind === REMOVE_USER_KIND) && getTagValue(e, "p") === pubkey,
  );

  if (membershipEvents.length === 0) return undefined;

  // Sort by created_at descending to get the latest event
  const sorted = membershipEvents.sort((a, b) => b.created_at - a.created_at);
  const latest = sorted[0];

  // Latest event determines membership status
  return latest.kind === PUT_USER_KIND;
}
