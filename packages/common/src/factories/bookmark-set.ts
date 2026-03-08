import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer, EventPointer } from "applesauce-core/helpers/pointers";
import { addEventBookmarkTag, removeEventBookmarkTag } from "../operations/tag/bookmarks.js";
import { NIP51ItemListFactory } from "./list.js";

export type BookmarkSetTemplate = KnownEventTemplate<kinds.Bookmarksets>;

/** A factory class for building kind 30003 bookmark set events */
export class BookmarkSetFactory extends NIP51ItemListFactory<kinds.Bookmarksets, BookmarkSetTemplate> {
  /** Creates a new bookmark set factory */
  static create(): BookmarkSetFactory {
    return new BookmarkSetFactory((res) => res(blankEventTemplate(kinds.Bookmarksets)));
  }

  /** Creates a new bookmark set factory from an existing bookmark set event */
  static modify(event: NostrEvent | KnownEvent<kinds.Bookmarksets>): BookmarkSetFactory {
    if (!isKind(event, kinds.Bookmarksets)) throw new Error("Event is not a bookmark set event");
    return new BookmarkSetFactory((res) => res(toEventTemplate(event)));
  }

  /** Bookmarks an event — uses "a" tag for articles, "e" tag for notes */
  bookmarkEvent(event: NostrEvent | EventPointer | AddressPointer, hidden = false) {
    return hidden
      ? this.modifyHiddenTags(addEventBookmarkTag(event))
      : this.modifyPublicTags(addEventBookmarkTag(event));
  }

  /** Removes a bookmark — uses "a" tag for articles, "e" tag for notes */
  unbookmarkEvent(event: NostrEvent | EventPointer | AddressPointer, hidden = false) {
    return hidden
      ? this.modifyHiddenTags(removeEventBookmarkTag(event))
      : this.modifyPublicTags(removeEventBookmarkTag(event));
  }
}
