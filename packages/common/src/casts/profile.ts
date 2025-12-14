import { NostrEvent, ProfileEvent } from "applesauce-core/helpers";
import { getDisplayName, getProfileContent, getProfilePicture, isValidProfile } from "applesauce-core/helpers/profile";
import { EventCast } from "./cast.js";

/** Cast a kind 0 event to a Profile */
export class Profile extends EventCast<ProfileEvent> {
  constructor(event: NostrEvent) {
    if (!isValidProfile(event)) throw new Error("Invalid profile");
    super(event);
  }
  get metadata() {
    return getProfileContent(this.event);
  }
  get name() {
    return this.metadata.name;
  }
  get displayName() {
    return getDisplayName(this.metadata);
  }
  get about() {
    return this.metadata.about;
  }
  get picture() {
    return getProfilePicture(this.metadata);
  }
  get dnsIdentity() {
    return this.metadata.nip05;
  }
  get website() {
    return this.metadata.website;
  }
  get lud16() {
    return this.metadata.lud16;
  }
  get lud06() {
    return this.metadata.lud06;
  }

  get lightningAddress() {
    return this.metadata.lud16 || this.metadata.lud06;
  }
}
