import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer, EventPointer } from "applesauce-core/helpers/pointers";
import { addEventBookmarkTag, removeEventBookmarkTag } from "../operations/tag/bookmarks.js";
import { NIP51ItemListFactory } from "./list.js";

export type BookmarkListTemplate = KnownEventTemplate<kinds.BookmarkList>;

/** A factory class for building kind 10003 bookmark list events */
export class BookmarkListFactory extends NIP51ItemListFactory<kinds.BookmarkList, BookmarkListTemplate> {
  /** Creates a new bookmark list factory */
  static create(): BookmarkListFactory {
    return new BookmarkListFactory((res) => res(blankEventTemplate(kinds.BookmarkList)));
  }

  /** Creates a new bookmark list factory from an existing bookmark list event */
  static modify(event: NostrEvent | KnownEvent<kinds.BookmarkList>): BookmarkListFactory {
    if (!isKind(event, kinds.BookmarkList)) throw new Error("Event is not a bookmark list event");
    return new BookmarkListFactory((res) => res(toEventTemplate(event)));
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

  /** Bookmarks a URL by adding an "r" tag */
  bookmarkUrl(url: string, hidden = false) {
    return this.addUrlItem(url, hidden);
  }

  /** Removes a bookmarked URL */
  unbookmarkUrl(url: string, hidden = false) {
    return this.removeUrlItem(url, hidden);
  }

  /** Bookmarks a hashtag by adding a "t" tag */
  bookmarkHashtag(hashtag: string, hidden = false) {
    return this.addHashtagItem(hashtag, hidden);
  }

  /** Removes a bookmarked hashtag */
  unbookmarkHashtag(hashtag: string, hidden = false) {
    return this.removeHashtagItem(hashtag, hidden);
  }
}
