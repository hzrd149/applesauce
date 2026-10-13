import { NostrEvent, ProfileEvent } from "applesauce-core/helpers";
import { getDisplayName, getProfileContent, getProfilePicture, isValidProfile } from "applesauce-core/helpers/profile";
import { isTTag } from "applesauce-core/helpers/tags";
import { getMediaAttachments } from "../helpers/file-metadata.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast a kind 0 event to a Profile */
export class Profile extends EventCast<ProfileEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidProfile(event)) throw new Error("Invalid profile");
    super(event, store);
  }
  /** The parsed JSON content of the profile */
  get metadata() {
    return getProfileContent(this.event);
  }
  /** The nickname or full name of the user */
  get name() {
    return this.metadata.name;
  }
  /** The display name with fallback to the name */
  get displayName() {
    return getDisplayName(this.metadata);
  }
  /** The short bio of the user */
  get about() {
    return this.metadata.about;
  }
  /** The profile picture URL */
  get picture() {
    return getProfilePicture(this.metadata);
  }
  /** The NIP-92 imeta metadata for the profile picture */
  get pictureMetadata() {
    const url = this.picture;
    return url ? getMediaAttachments(this.event).find((m) => m.url === url) : undefined;
  }
  /** The wide banner image URL */
  get banner() {
    return this.metadata.banner;
  }
  /** The NIP-92 imeta metadata for the banner image */
  get bannerMetadata() {
    const url = this.banner;
    return url ? getMediaAttachments(this.event).find((m) => m.url === url) : undefined;
  }
  /** The NIP-05 DNS identifier */
  get dnsIdentity() {
    return this.metadata.nip05;
  }
  /** The website URL */
  get website() {
    return this.metadata.website;
  }
  /** The LUD-16 lightning address */
  get lud16() {
    return this.metadata.lud16;
  }
  /** The LUD-06 LNURL */
  get lud06() {
    return this.metadata.lud06;
  }
  /** The LUD-16 lightning address with fallback to the LUD-06 LNURL */
  get lightningAddress() {
    return this.metadata.lud16 || this.metadata.lud06;
  }
  /** Whether the profile is automated */
  get bot() {
    return this.metadata.bot;
  }
  /** The birth date of the user, each field may be missing */
  get birthday() {
    return this.metadata.birthday;
  }
  /** The preferred languages of the user in BCP 47 format */
  get languages() {
    return this.metadata.languages;
  }
  /** The lowercase hashtags from the NIP-24 "t" tags */
  get hashtags() {
    return this.event.tags.filter(isTTag).map((t) => t[1].toLowerCase());
  }
}
