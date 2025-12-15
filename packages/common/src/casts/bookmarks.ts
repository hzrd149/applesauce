import {
  hasHiddenContent,
  HiddenContentSigner,
  isAddressPointer,
  isEventPointer,
  NostrEvent,
} from "applesauce-core/helpers";
import { defined, watchEventUpdates } from "applesauce-core/observable";
import { combineLatest, map, of, switchMap } from "rxjs";
import {
  BookmarkListEvent,
  BookmarkSetEvent,
  getBookmarks,
  getHiddenBookmarks,
  isHiddenBookmarksUnlocked,
  isValidBookmarkList,
  isValidBookmarkSet,
  unlockHiddenBookmarks,
} from "../helpers/bookmark.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { Article } from "./article.js";
import { EventCast } from "./cast.js";
import { Note } from "./note.js";

/** Base class for bookmarks lists and sets */
class BookmarksListBase<T extends BookmarkListEvent | BookmarkSetEvent> extends EventCast<T> {
  constructor(event: T) {
    if (!isValidBookmarkList(event) && !isValidBookmarkSet(event)) throw new Error("Invalid bookmark list or set");
    super(event);
  }

  get bookmarks() {
    return getBookmarks(this.event);
  }

  get articles() {
    return this.bookmarks.filter((pointer) => isAddressPointer(pointer));
  }
  get notes() {
    return this.bookmarks.filter((pointer) => isEventPointer(pointer));
  }

  get notes$() {
    return this.$$ref("notes$", (store) =>
      combineLatest(this.notes.map((pointer) => store.event(pointer))).pipe(
        map((arr) => arr.filter((e) => !!e)),
        castTimelineStream(Note),
      ),
    );
  }
  get articles$() {
    return this.$$ref("articles$", (store) =>
      combineLatest(this.articles.map((pointer) => store.replaceable(pointer))).pipe(
        map((arr) => arr.filter((e) => !!e)),
        castTimelineStream(Article),
      ),
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
  get hiddenNotes$() {
    return this.$$ref("hiddenNotes$", (store) =>
      this.hidden$.pipe(
        switchMap((hidden) =>
          combineLatest(hidden.filter((pointer) => isEventPointer(pointer)).map((pointer) => store.event(pointer))),
        ),
        map((arr) => arr.filter((e) => !!e)),
        castTimelineStream(Note),
      ),
    );
  }
  get hiddenArticles$() {
    return this.$$ref("hiddenArticles$", (store) =>
      this.hidden$.pipe(
        switchMap((hidden) =>
          combineLatest(
            hidden.filter((pointer) => isAddressPointer(pointer)).map((pointer) => store.replaceable(pointer)),
          ),
        ),
        map((arr) => arr.filter((e) => !!e)),
        castTimelineStream(Article),
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
  async unlock(signer: HiddenContentSigner) {
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
