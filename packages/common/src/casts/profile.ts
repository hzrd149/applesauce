import { getDisplayName, getProfileContent, getProfilePicture, isValidProfile } from "applesauce-core/helpers/profile";
import { map } from "rxjs";
import { ref } from "./common.js";
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

  get contacts$() {
    return ref(this, "contacts$", (store) => store.contacts(this.pubkey));
  },
  get mailboxes$() {
    return ref(this, "mailboxes$", (store) => store.mailboxes(this.pubkey));
  },
  get outboxes$() {
    return this.mailboxes$.pipe(map((mailboxes) => mailboxes?.outboxes));
  },
  get inboxes$() {
    return this.mailboxes$.pipe(map((mailboxes) => mailboxes?.inboxes));
  },
});

export type Profile = InferCast<typeof castProfile>;
