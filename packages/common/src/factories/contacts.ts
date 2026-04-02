import { blankEventTemplate, EventFactory, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { fillAndTrimTag } from "applesauce-core/helpers/tags";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { addProfilePointerTag, removeProfilePointerTag } from "applesauce-core/operations/tag/common";

export type ContactsTemplate = KnownEventTemplate<kinds.Contacts>;

/** A factory class for building kind 3 contacts events */
export class ContactsFactory extends EventFactory<kinds.Contacts, ContactsTemplate> {
  /** Creates a new contacts factory */
  static create(): ContactsFactory {
    return new ContactsFactory((res) => res(blankEventTemplate(kinds.Contacts)));
  }

  /** Creates a new contacts factory from an existing contacts event */
  static modify(event: NostrEvent | KnownEvent<kinds.Contacts>): ContactsFactory {
    if (!isKind(event, kinds.Contacts)) throw new Error("Event is not a contacts event");
    return new ContactsFactory((res) => res(toEventTemplate(event)));
  }

  /**
   * Adds or replaces a contact "p" tag.
   * @param pointer - Pubkey string or ProfilePointer (relay hint taken from pointer.relays[0])
   * @param petname - Optional NIP-02 petname stored as the fourth tag field
   */
  addContact(pointer: string | ProfilePointer, petname?: string) {
    if (!petname) return this.modifyPublicTags(addProfilePointerTag(pointer));

    const pubkey = typeof pointer === "string" ? pointer : pointer.pubkey;
    const relay = typeof pointer === "object" ? pointer.relays?.[0] : undefined;

    return this.modifyPublicTags((tags) => {
      const filtered = tags.filter((t) => !(t[0] === "p" && t[1] === pubkey));
      return [...filtered, fillAndTrimTag(["p", pubkey, relay, petname])];
    });
  }

  /** Removes a contact "p" tag by pubkey */
  removeContact(pointer: string | ProfilePointer) {
    return this.modifyPublicTags(removeProfilePointerTag(pointer));
  }
}
