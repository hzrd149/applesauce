import { kinds, NostrEvent, ProfileEvent } from "applesauce-core/helpers";
import { getDisplayName, getProfileContent, getProfilePicture, isValidProfile } from "applesauce-core/helpers/profile";
import { CastRefEventStore, EventCast } from "./cast.js";
import { combineLatest, map } from "rxjs";
import { ChainableObservable } from "../observable/chainable.js";
import { LEGACY_PROFILE_BADGES_IDENTIFIER, PROFILE_BADGES_KIND, compareProfileBadgeEvents } from "../helpers/badges.js";
import { castEventStream } from "../observable/cast-stream.js";
import { ProfileBadges } from "./profile-badges.js";

/** Cast a kind 0 event to a Profile */
export class Profile extends EventCast<ProfileEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidProfile(event)) throw new Error("Invalid profile");
    super(event, store);
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
  get banner() {
    return this.metadata.banner;
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
  get bot() {
    return this.metadata.bot;
  }
  get birthday() {
    return this.metadata.birthday;
  }
  get languages() {
    return this.metadata.languages;
  }

  get badges$(): ChainableObservable<ProfileBadges | undefined> {
    return this.$$ref("badges$", (store) =>
      combineLatest([
        store.replaceable({ kind: PROFILE_BADGES_KIND, pubkey: this.event.pubkey }),
        store.replaceable({
          kind: kinds.ProfileBadges,
          pubkey: this.event.pubkey,
          identifier: LEGACY_PROFILE_BADGES_IDENTIFIER,
        }),
      ]).pipe(
        map(([modern, legacy]) => compareProfileBadgeEvents(modern, legacy)),
        castEventStream(ProfileBadges, store),
      ),
    );
  }
}
