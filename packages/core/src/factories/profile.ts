import { isKind } from "nostr-tools/kinds";
import { kinds, KnownEvent, KnownEventTemplate } from "../helpers/event.js";
import { ProfileContent } from "../helpers/index.js";
import { setProfile, updateProfile } from "../operations/profile.js";
import { blankEventTemplate, EventFactory, toEventTemplate } from "./event.js";

export type ProfileTemplate = KnownEventTemplate<kinds.Metadata>;

/** A factory class for building kind 0 profile/metadata events */
export class ProfileFactory<T extends ProfileTemplate = ProfileTemplate> extends EventFactory<kinds.Metadata, T> {
  /**
   * Creates a new profile factory
   * @returns A new profile factory
   */
  static create(): ProfileFactory {
    return new ProfileFactory((res) => res(blankEventTemplate(kinds.Metadata)));
  }

  /**
   * Creates a new profile factory from an existing metadata event with validation
   * @param event - The existing metadata event
   * @returns A new profile factory
   */
  static modify(event: KnownEvent<kinds.Metadata>): ProfileFactory {
    if (!isKind(event, kinds.Metadata)) throw new Error("Event is not a profile event");
    return new ProfileFactory((res) => res(toEventTemplate(event)));
  }

  /** Sets the entire profile content, replacing any existing content */
  override(content: ProfileContent) {
    return this.chain(setProfile(content));
  }

  /** Updates specific fields in the profile content, merging with existing content */
  update(content: Partial<ProfileContent>) {
    return this.chain(updateProfile(content));
  }

  /** Sets the display name */
  name(name: string) {
    return this.chain(updateProfile({ name }));
  }

  /** Sets the username */
  username(username: string) {
    return this.chain(updateProfile({ username }));
  }

  /** Sets the display name (alias for name) */
  displayName(displayName: string) {
    return this.chain(updateProfile({ display_name: displayName }));
  }

  /** Sets the about/bio text */
  about(about: string) {
    return this.chain(updateProfile({ about }));
  }

  /** Sets the profile picture URL */
  picture(picture: string) {
    return this.chain(updateProfile({ picture }));
  }

  /** Sets the banner image URL */
  banner(banner: string) {
    return this.chain(updateProfile({ banner }));
  }

  /** Sets the website URL */
  website(website: string) {
    return this.chain(updateProfile({ website }));
  }

  /** Sets the NIP-05 identifier */
  nip05(nip05: string) {
    return this.chain(updateProfile({ nip05 }));
  }

  /** Sets the Lightning Network address */
  lnurlp(lnurlp: string) {
    return this.chain(updateProfile({ lud06: lnurlp }));
  }

  /** Sets the Lightning Network address (LNURL) */
  lightningAddress(address: string) {
    return this.chain(updateProfile({ lud16: address }));
  }

  /** Sets the bot flag */
  bot(bot: boolean) {
    return this.chain(updateProfile({ bot }));
  }

  /** Sets the languages */
  languages(languages: string[]) {
    return this.chain(updateProfile({ languages }));
  }
}
