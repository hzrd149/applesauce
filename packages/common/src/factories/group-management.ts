import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
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

export type GroupMembershipOptions = {
  previous?: NostrEvent[];
  reason?: string;
};

// Join Request Factory
export class GroupJoinRequestFactory extends EventFactory<
  typeof JOIN_REQUEST_KIND,
  KnownEventTemplate<typeof JOIN_REQUEST_KIND>
> {
  static create(group: GroupPointer, reason?: string, inviteCode?: string): GroupJoinRequestFactory {
    const factory = new GroupJoinRequestFactory((res) => res(blankEventTemplate(JOIN_REQUEST_KIND)))
      .group(group)
      .joinRequest(group, inviteCode);
    return reason ? factory.content(reason) : factory;
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  joinRequest(group: GroupPointer, inviteCode?: string) {
    return this.chain((draft) => setJoinRequestTags(group, inviteCode)(draft));
  }
}

// Leave Request Factory
export class GroupLeaveRequestFactory extends EventFactory<
  typeof LEAVE_REQUEST_KIND,
  KnownEventTemplate<typeof LEAVE_REQUEST_KIND>
> {
  static create(group: GroupPointer, reason?: string): GroupLeaveRequestFactory {
    const factory = new GroupLeaveRequestFactory((res) => res(blankEventTemplate(LEAVE_REQUEST_KIND)))
      .group(group)
      .leaveRequest(group);
    return reason ? factory.content(reason) : factory;
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  leaveRequest(group: GroupPointer) {
    return this.chain((draft) => setLeaveRequestTags(group)(draft));
  }
}

// Put User Factory
export class PutUserFactory extends EventFactory<typeof PUT_USER_KIND, KnownEventTemplate<typeof PUT_USER_KIND>> {
  static create(group: GroupPointer, pubkey: string, roles?: string[]): PutUserFactory {
    return new PutUserFactory((res) => res(blankEventTemplate(PUT_USER_KIND))).group(group).user(pubkey, roles);
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  user(pubkey: string, roles?: string[]) {
    return this.chain((draft) => setPutUserTags(pubkey, roles)(draft));
  }

  previous(events: NostrEvent[]) {
    return this.chain((draft) => addPreviousRefs(events)(draft));
  }

  reason(text: string) {
    return this.chain((draft) => setContent(text)(draft));
  }
}

// Remove User Factory
export class RemoveUserFactory extends EventFactory<
  typeof REMOVE_USER_KIND,
  KnownEventTemplate<typeof REMOVE_USER_KIND>
> {
  static create(group: GroupPointer, pubkey: string): RemoveUserFactory {
    return new RemoveUserFactory((res) => res(blankEventTemplate(REMOVE_USER_KIND))).group(group).user(pubkey);
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  user(pubkey: string) {
    return this.chain((draft) => setRemoveUserTags(pubkey)(draft));
  }

  previous(events: NostrEvent[]) {
    return this.chain((draft) => addPreviousRefs(events)(draft));
  }

  reason(text: string) {
    return this.chain((draft) => setContent(text)(draft));
  }
}

// Edit Metadata Factory
export class EditGroupMetadataFactory extends EventFactory<
  typeof EDIT_METADATA_KIND,
  KnownEventTemplate<typeof EDIT_METADATA_KIND>
> {
  static create(group: GroupPointer, metadata: GroupMetadata): EditGroupMetadataFactory {
    return new EditGroupMetadataFactory((res) => res(blankEventTemplate(EDIT_METADATA_KIND)))
      .group(group)
      .metadata(metadata);
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  metadata(metadata: GroupMetadata) {
    return this.chain((draft) => setEditMetadataTags(metadata)(draft));
  }

  previous(events: NostrEvent[]) {
    return this.chain((draft) => addPreviousRefs(events)(draft));
  }
}

// Delete Event Factory
export class DeleteGroupEventFactory extends EventFactory<
  typeof DELETE_EVENT_KIND,
  KnownEventTemplate<typeof DELETE_EVENT_KIND>
> {
  static create(group: GroupPointer, eventId: string): DeleteGroupEventFactory {
    return new DeleteGroupEventFactory((res) => res(blankEventTemplate(DELETE_EVENT_KIND))).group(group).event(eventId);
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  event(eventId: string) {
    return this.chain((draft) => setDeleteEventTags(eventId)(draft));
  }

  previous(events: NostrEvent[]) {
    return this.chain((draft) => addPreviousRefs(events)(draft));
  }
}

// Create Group Factory
export class CreateGroupFactory extends EventFactory<
  typeof CREATE_GROUP_KIND,
  KnownEventTemplate<typeof CREATE_GROUP_KIND>
> {
  static create(groupId: string, metadata: GroupMetadata): CreateGroupFactory {
    return new CreateGroupFactory((res) => res(blankEventTemplate(CREATE_GROUP_KIND)))
      .groupId(groupId)
      .metadata(metadata);
  }

  groupId(id: string) {
    return this.chain((draft) => setGroupPointer({ id, relay: "" })(draft));
  }

  metadata(metadata: GroupMetadata) {
    return this.chain((draft) => setEditMetadataTags(metadata)(draft));
  }
}

// Delete Group Factory
export class DeleteGroupFactory extends EventFactory<
  typeof DELETE_GROUP_KIND,
  KnownEventTemplate<typeof DELETE_GROUP_KIND>
> {
  static create(group: GroupPointer): DeleteGroupFactory {
    return new DeleteGroupFactory((res) => res(blankEventTemplate(DELETE_GROUP_KIND))).group(group);
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  previous(events: NostrEvent[]) {
    return this.chain((draft) => addPreviousRefs(events)(draft));
  }
}

// Create Invite Factory
export class CreateGroupInviteFactory extends EventFactory<
  typeof CREATE_INVITE_KIND,
  KnownEventTemplate<typeof CREATE_INVITE_KIND>
> {
  static create(group: GroupPointer): CreateGroupInviteFactory {
    return new CreateGroupInviteFactory((res) => res(blankEventTemplate(CREATE_INVITE_KIND))).group(group);
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }
}
