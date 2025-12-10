import { getDisplayName, getProfileContent, getProfilePicture, isValidProfile } from "applesauce-core/helpers/profile";
import { ProfilePointer } from "nostr-tools/nip19";
import { map, Observable } from "rxjs";
import { getStore } from "./common.js";
import { createCast, InferCast } from "./index.js";

/** Cast a kind 0 event to a Profile */
export const castProfile = createCast(isValidProfile, {
  get name() {
    return getProfileContent(this)?.name;
  },
  get displayName() {
    return getDisplayName(this);
  },
  get about() {
    return getProfileContent(this)?.about;
  },
  get picture() {
    return getProfilePicture(this);
  },

  get contacts$(): Observable<ProfilePointer[]> {
    return getStore(this).contacts(this.pubkey);
  },
  get mailboxes$(): Observable<{ inboxes: string[]; outboxes: string[] } | undefined> {
    return getStore(this).mailboxes(this.pubkey);
  },
  get outboxes$(): Observable<string[] | undefined> {
    return getStore(this)
      .mailboxes(this.pubkey)
      .pipe(map((mailboxes) => mailboxes?.outboxes));
  },
  get inboxes$(): Observable<string[] | undefined> {
    return getStore(this)
      .mailboxes(this.pubkey)
      .pipe(map((mailboxes) => mailboxes?.inboxes));
  },
});

export type Profile = InferCast<typeof castProfile>;
