import { EventOperation, TagOperation } from "applesauce-core/event-factory";
import {
  ensureNamedValueTag,
  ensureWebSocketURL,
  EventPointer,
  fillAndTrimTag,
  NameValueTag,
  ProfilePointer,
} from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  addEventPointerTag,
  addNameValueTag,
  addProfilePointerTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { GroupMetadata, GroupPointer } from "../helpers/groups.js";

/** Creates a "h" tag for chat messages from a {@link GroupPointer} */
function createGroupHTagFromGroupPointer(group: GroupPointer): NameValueTag {
  return fillAndTrimTag(["h", group.id, ensureWebSocketURL(group.relay)]) as NameValueTag;
}

/** Creates a "group" tag from a {@link GroupPointer} */
function createGroupTagFromGroupPointer(group: GroupPointer): NameValueTag {
  return fillAndTrimTag(["group", group.id, ensureWebSocketURL(group.relay), group.name], 3) as NameValueTag;
}

/** A tag operation for setting the "h" tag for a group */
function setGroupHTag(group: GroupPointer): TagOperation {
  return setSingletonTag(createGroupHTagFromGroupPointer(group));
}

/** Adds a "group" tag to a list */
export function addGroupTag(group: GroupPointer): EventOperation {
  return modifyPublicTags((tags) => {
    // remove existing tag
    tags = tags.filter((t) => !(t[0] === "group" && t[1] === group.id && t[2] === group.relay));

    return [...tags, createGroupTagFromGroupPointer(group)];
  });
}

/** Removes a "group" tag from a list */
export function removeGroupTag(group: GroupPointer): EventOperation {
  return modifyPublicTags((tags) =>
    tags.filter((tag) => tag[0] === "group" && tag[1] === group.id && tag[2] === group.relay),
  );
}

/** Sets the "h" tag for NIP-29 group messages or other events */
export function setGroupPointer(group: GroupPointer): EventOperation {
  return modifyPublicTags(setGroupHTag(group));
}

/** Adds "previous" tags for group messages */
export function addPreviousRefs(previous: NostrEvent[], count = 6): EventOperation {
  return (draft) => {
    let tags = Array.from(draft.tags);

    // sort previous events by date and limit to 50
    const sorted = previous.sort((a, b) => b.created_at - a.created_at).slice(0, 50);

    for (let i = 0; i < count; i++) {
      const index = Math.round(Math.random() * (sorted.length - 1));
      const event = sorted.splice(index, 1)[0];

      if (event) tags = ensureNamedValueTag(tags, ["previous", event.id.slice(0, 8)]);
    }

    return { ...draft, tags };
  };
}

/** Sets tags for a join request (kind 9021) */
export function setJoinRequestTags(group: GroupPointer, inviteCode?: string): EventOperation {
  return modifyPublicTags(setGroupHTag(group), inviteCode ? addNameValueTag(["code", inviteCode]) : undefined);
}

/** Sets tags for a leave request (kind 9022) */
export function setLeaveRequestTags(group: GroupPointer): EventOperation {
  return modifyPublicTags(setGroupHTag(group));
}

/** Sets tags for put user (kind 9000) */
export function setPutUserTags(user: string | ProfilePointer, roles?: string[]): EventOperation {
  const pubkey = typeof user === "string" ? user : user.pubkey;
  const tag: NameValueTag = roles && roles.length > 0 ? ["p", pubkey, ...roles] : ["p", pubkey];
  return modifyPublicTags(addNameValueTag(tag));
}

/** Sets tags for remove user (kind 9001) */
export function setRemoveUserTags(user: string | ProfilePointer): EventOperation {
  return modifyPublicTags(addProfilePointerTag(user));
}

/** Sets tags for edit metadata (kind 9002) */
export function setEditMetadataTags(fields: Partial<GroupMetadata>): EventOperation {
  return modifyPublicTags(
    fields.name !== undefined ? setSingletonTag(["name", fields.name]) : undefined,
    fields.picture !== undefined ? setSingletonTag(["picture", fields.picture]) : undefined,
    fields.about !== undefined ? setSingletonTag(["about", fields.about]) : undefined,
    fields.isPublic ? setSingletonTag(["public"]) : undefined,
    fields.isPrivate ? setSingletonTag(["private"]) : undefined,
    fields.isOpen ? setSingletonTag(["open"]) : undefined,
    fields.isClosed ? setSingletonTag(["closed"]) : undefined,
  );
}

/** Sets tags for delete event (kind 9005) */
export function setDeleteEventTags(event: string | EventPointer | NostrEvent): EventOperation {
  return modifyPublicTags(addEventPointerTag(event));
}
