import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { EventPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import {
  addEventPointerTag,
  addNameValueTag,
  removeEventPointerTag,
  removeNameValueTag,
} from "applesauce-core/operations/tag/common";
import { NIP51UserListFactory } from "./list.js";

export type MuteListTemplate = KnownEventTemplate<kinds.Mutelist>;

/** A factory class for building kind 10000 mute list events */
export class MuteListFactory extends NIP51UserListFactory<kinds.Mutelist, MuteListTemplate> {
  /** Creates a new mute list factory */
  static create(): MuteListFactory {
    return new MuteListFactory((res) => res(blankEventTemplate(kinds.Mutelist)));
  }

  /** Creates a new mute list factory from an existing mute list event */
  static modify(event: NostrEvent | KnownEvent<kinds.Mutelist>): MuteListFactory {
    if (!isKind(event, kinds.Mutelist)) throw new Error("Event is not a mute list event");
    return new MuteListFactory((res) => res(toEventTemplate(event)));
  }

  /** Mutes a thread by event id or EventPointer */
  muteThread(thread: string | NostrEvent | EventPointer, hidden = false) {
    return hidden
      ? this.modifyHiddenTags(addEventPointerTag(thread))
      : this.modifyPublicTags(addEventPointerTag(thread));
  }

  /** Unmutes a thread by event id or EventPointer */
  unmuteThread(thread: string | EventPointer, hidden = false) {
    return hidden
      ? this.modifyHiddenTags(removeEventPointerTag(thread))
      : this.modifyPublicTags(removeEventPointerTag(thread));
  }

  /** Mutes a word */
  muteWord(word: string, hidden = false) {
    const op = addNameValueTag(["word", word.toLocaleLowerCase()], true);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }

  /** Unmutes a word */
  unmuteWord(word: string, hidden = false) {
    const op = removeNameValueTag(["word", word.toLocaleLowerCase()]);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }

  /** Mutes a hashtag */
  muteHashtag(hashtag: string, hidden = false) {
    const op = addNameValueTag(["t", hashtag.toLocaleLowerCase()], true);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }

  /** Unmutes a hashtag */
  unmuteHashtag(hashtag: string, hidden = false) {
    const op = removeNameValueTag(["t", hashtag.toLocaleLowerCase()]);
    return hidden ? this.modifyHiddenTags(op) : this.modifyPublicTags(op);
  }

  /** Mutes a pubkey — semantic alias for addUser() */
  mutePubkey(pubkey: string | ProfilePointer, hidden = false) {
    return this.addUser(pubkey, hidden);
  }

  /** Unmutes a pubkey — semantic alias for removeUser() */
  unmutePubkey(pubkey: string | ProfilePointer, hidden = false) {
    return this.removeUser(pubkey, hidden);
  }
}
