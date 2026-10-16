import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { kinds, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { includeEmojis, setContent } from "applesauce-core/operations/content";
import { removeSingletonTag } from "applesauce-core/operations/tag/common";
import { Emoji } from "../helpers/emoji.js";
import { UserStatusPointer, UserStatusType } from "../helpers/user-status.js";
import { clearStatusLink, setStatusLink, setStatusType } from "../operations/user-status.js";

const removeEmojiTags = (tags: string[][]) => tags.filter((t) => t[0] !== "emoji");

export type UserStatusTemplate = KnownEventTemplate<typeof kinds.UserStatuses>;

/** A factory class for building NIP-38 user status events (kind 30315) */
export class UserStatusFactory extends EventFactory<typeof kinds.UserStatuses, UserStatusTemplate> {
  /** Creates a new user status factory for a status type */
  static create(type: UserStatusType = "general", content = ""): UserStatusFactory {
    return new UserStatusFactory((res) => res(blankEventTemplate(kinds.UserStatuses))).type(type).status(content);
  }

  /** Creates a "music" status that expires when the track stops playing */
  static music(content: string, expiration?: number, link?: string | UserStatusPointer): UserStatusFactory {
    let factory = UserStatusFactory.create("music", content);
    if (expiration) factory = factory.expiration(expiration);
    if (link) factory = factory.link(link);
    return factory;
  }

  /** Creates a factory configured to modify an existing user status */
  static modify(event: NostrEvent): UserStatusFactory {
    if (event.kind !== kinds.UserStatuses) throw new Error("Expected a user status event");
    return new UserStatusFactory((res) => res(toEventTemplate(event) as UserStatusTemplate));
  }

  /** Sets the status type ("d" tag) */
  type(type: UserStatusType) {
    return this.chain(setStatusType(type));
  }

  /** Sets the status text and includes any NIP-30 custom emojis used in it */
  status(content: string, emojis?: Emoji[]) {
    return this.modifyPublicTags(removeEmojiTags).chain(setContent(content)).chain(includeEmojis(emojis));
  }

  /** Sets the URL, profile, event, or address the status links to */
  link(link: string | UserStatusPointer) {
    return this.chain(setStatusLink(link));
  }

  /** Removes the status link */
  clearLink() {
    return this.chain(clearStatusLink());
  }

  /** Removes the expiration timestamp */
  clearExpiration() {
    return this.modifyPublicTags(removeSingletonTag("expiration"));
  }

  /** Clears the status by removing the content, link, emojis, and expiration */
  clear() {
    return this.status("").clearLink().clearExpiration();
  }
}
