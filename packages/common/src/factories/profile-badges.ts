import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { LEGACY_PROFILE_BADGES_KIND, PROFILE_BADGES_KIND } from "../helpers/profile-badges.js";
import type { ProfileBadgeSlotInput } from "../operations/profile-badges.js";
import {
  addSlot,
  appendSlot,
  clearSlots,
  insertSlot,
  prependSlot,
  removeSlotByAward,
  removeSlotByBadge,
  setSlot,
  setSlots,
} from "../operations/profile-badges.js";

export type ProfileBadgesTemplate = KnownEventTemplate<typeof PROFILE_BADGES_KIND>;

/** Factory for profile badges events (kind 10008) */
export class ProfileBadgesFactory extends EventFactory<typeof PROFILE_BADGES_KIND, ProfileBadgesTemplate> {
  /** Creates a profile badges factory */
  static create(): ProfileBadgesFactory {
    return new ProfileBadgesFactory((res) => res(blankEventTemplate(PROFILE_BADGES_KIND)));
  }

  /** Creates a factory configured to modify an existing profile badge event */
  static modify(event: NostrEvent): ProfileBadgesFactory {
    if (event.kind !== PROFILE_BADGES_KIND && event.kind !== LEGACY_PROFILE_BADGES_KIND)
      throw new Error("Expected a profile badges event");
    return new ProfileBadgesFactory((res) => res(toEventTemplate(event) as ProfileBadgesTemplate));
  }

  /** Replaces all slots */
  slots(slots: Array<ProfileBadgeSlotInput>) {
    return this.chain(setSlots(slots));
  }

  /** Adds a single slot to the end */
  addSlot(slot: ProfileBadgeSlotInput) {
    return this.chain(addSlot(slot));
  }

  /** Inserts a slot at a specific position */
  insertSlot(index: number, slot: ProfileBadgeSlotInput) {
    return this.chain(insertSlot(index, slot));
  }

  /** Inserts a slot at the beginning */
  prependSlot(slot: ProfileBadgeSlotInput) {
    return this.chain(prependSlot(slot));
  }

  /** Inserts a slot at the end */
  appendSlot(slot: ProfileBadgeSlotInput) {
    return this.chain(appendSlot(slot));
  }

  /** Replaces the slot at a specific position */
  setSlot(index: number, slot: ProfileBadgeSlotInput) {
    return this.chain(setSlot(index, slot));
  }

  /** Removes every slot */
  clearSlots() {
    return this.chain(clearSlots());
  }

  /** Removes the slot tied to a badge definition */
  removeByBadge(badge: Parameters<typeof removeSlotByBadge>[0]) {
    return this.chain(removeSlotByBadge(badge));
  }

  /** Removes the slot tied to an award event */
  removeByAward(award: Parameters<typeof removeSlotByAward>[0]) {
    return this.chain(removeSlotByAward(award));
  }
}
