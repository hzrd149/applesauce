import { defined, watchEventUpdates } from "applesauce-core";
import { hasHiddenContent, HiddenContentSigner, NostrEvent } from "applesauce-core/helpers";
import { combineLatest, map, of } from "rxjs";
import {
  BookmarkListEvent,
  Bookmarks,
  BookmarkSetEvent,
  getBookmarks,
  getHiddenBookmarks,
  isHiddenBookmarksUnlocked,
  isValidBookmarkList,
  isValidBookmarkSet,
  unlockHiddenBookmarks,
} from "../helpers/bookmark.js";
import { EventCast } from "./cast.js";

/** Base class for bookmarks lists and sets */
class BookmarksListBase<T extends BookmarkListEvent | BookmarkSetEvent> extends EventCast<T> implements Bookmarks {
  constructor(event: T) {
    if (!isValidBookmarkList(event) && !isValidBookmarkSet(event)) throw new Error("Invalid bookmark list or set");
    super(event);
  }

  get bookmarks() {
    return getBookmarks(this.event);
  }

  get articles() {
    return this.bookmarks.articles;
  }
  get notes() {
    return this.bookmarks.notes;
  }
  get hashtags() {
    return this.bookmarks.hashtags;
  }
  get urls() {
    return this.bookmarks.urls;
  }

  get notes$() {
    return this.$$ref("notes$", (store) => combineLatest(this.notes.map((pointer) => store.event(pointer.id))));
  }
  get articles$() {
    return this.$$ref("articles$", (store) =>
      combineLatest(this.articles.map((pointer) => store.replaceable(pointer))),
    );
  }

  /** Get the unlocked hidden bookmarks */
  get hidden() {
    return getHiddenBookmarks(this.event);
  }
  /** An observable that updates when hidden bookmarks are unlocked */
  get hidden$() {
    return this.$$ref("hidden$", (store) =>
      of(this.event).pipe(
        // Watch for event updates
        watchEventUpdates(store),
        // Get hidden bookmarks
        map((event) => event && getHiddenBookmarks(event)),
        /** Only emit when the hidden bookmarks are unlocked */
        defined(),
      ),
    );
  }

  /** Whether the bookmark set has hidden bookmarks */
  get hasHidden() {
    return hasHiddenContent(this.event);
  }
  /** Whether the bookmark set is unlocked */
  get unlocked() {
    return isHiddenBookmarksUnlocked(this.event);
  }
  /** Unlocks the hidden bookmarks on the bookmark set */
  async unlock(signer: HiddenContentSigner): Promise<Bookmarks> {
    return unlockHiddenBookmarks(this.event, signer);
  }
}

/** A class for bookmarks lists (kind 10003) */
export class BookmarksList extends BookmarksListBase<BookmarkListEvent> {
  constructor(event: NostrEvent) {
    if (!isValidBookmarkList(event)) throw new Error("Invalid bookmark list");
    super(event);
  }
}

/** A class for bookmarks sets (kind 30003) */
export class BookmarksSet extends BookmarksListBase<BookmarkSetEvent> {
  constructor(event: NostrEvent) {
    if (!isValidBookmarkSet(event)) throw new Error("Invalid bookmark set");
    super(event);
  }
}
