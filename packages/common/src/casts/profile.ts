import { kinds, NostrEvent, ProfileEvent } from "applesauce-core/helpers";
import { getDisplayName, getProfileContent, getProfilePicture, isValidProfile } from "applesauce-core/helpers/profile";
import { castEvent } from "../observable/cast-event.js";
import { Mailboxes } from "./mailboxes.js";
import { Cast } from "./cast.js";

// NOTE: extending BaseCast since there is no need for author$ or comments$

/** Cast a kind 0 event to a Profile */
export class Profile extends Cast<ProfileEvent> {
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

  get contacts$() {
    return this.$$ref("contacts$", (store) => store.contacts(this.event.pubkey));
  }
  get mailboxes$() {
    return this.$$ref("mailboxes$", (store) =>
      store.replaceable({ kind: kinds.RelayList, pubkey: this.event.pubkey }).pipe(castEvent(Mailboxes)),
    );
  }
  get outboxes$() {
    return this.mailboxes$.outboxes;
  }
  get inboxes$() {
    return this.mailboxes$.outboxes;
  }
}
