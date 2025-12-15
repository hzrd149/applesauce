import { getOrComputeCachedValue, notifyEventUpdate } from "applesauce-core/helpers";
import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { getHiddenTags, isHiddenTagsUnlocked, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
  getReplaceableAddressFromPointer,
  mergeAddressPointers,
  mergeEventPointers,
} from "applesauce-core/helpers/pointers";

/** Type for a validated bookmark list event */
export type BookmarkListEvent = KnownEvent<kinds.BookmarkList>;
/** Type for a validated bookmark set event */
export type BookmarkSetEvent = KnownEvent<kinds.Bookmarksets>;

/** Validates that an event is a valid bookmark list (kind 10000) */
export function isValidBookmarkList(event: NostrEvent): event is BookmarkListEvent {
  return event.kind === kinds.BookmarkList;
}

/** Validates that an event is a valid bookmark set (kind 30003) */
export function isValidBookmarkSet(event: NostrEvent): event is BookmarkSetEvent {
  return event.kind === kinds.Bookmarksets;
}

export const BookmarkPublicSymbol = Symbol.for("bookmark-public");
export const BookmarkHiddenSymbol = Symbol.for("bookmark-hidden");

/** Type for unlocked bookmarks events */
export type UnlockedBookmarks = {
  [BookmarkHiddenSymbol]: Bookmarks;
};

export interface Bookmarks {
  notes: EventPointer[];
  articles: AddressPointer[];
  hashtags: string[];
  urls: string[];
}

/** Parses an array of tags into a {@link Bookmarks} object */
export function parseBookmarkTags(tags: string[][]): Bookmarks {
  const notes = tags
    .filter((t) => t[0] === "e" && t[1])
    .map(getEventPointerFromETag)
    .filter((pointer) => pointer !== null);
  const articles = tags
    .filter((t) => t[0] === "a" && t[1])
    .map(getAddressPointerFromATag)
    .filter((pointer) => pointer !== null)
    .filter((pointer) => pointer.kind === kinds.LongFormArticle);
  const hashtags = tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]);
  const urls = tags.filter((t) => t[0] === "r" && t[1]).map((t) => t[1]);

  return { notes, articles, hashtags, urls };
}

/** Merges any number of {@link Bookmarks} objects */
export function mergeBookmarks(...bookmarks: (Bookmarks | undefined)[]): Bookmarks {
  const notes: Map<string, EventPointer> = new Map();
  const articles = new Map<string, AddressPointer>();
  const hashtags: Set<string> = new Set();
  const urls: Set<string> = new Set();

  for (const bookmark of bookmarks) {
    if (!bookmark) continue;

    for (const note of bookmark.notes) {
      const existing = notes.get(note.id);
      if (existing) notes.set(note.id, mergeEventPointers(existing, note));
      else notes.set(note.id, note);
    }
    for (const article of bookmark.articles) {
      const coord = getReplaceableAddressFromPointer(article);
      const existing = articles.get(coord);
      if (existing) articles.set(coord, mergeAddressPointers(existing, article));
      else articles.set(coord, article);
    }
    for (const hashtag of bookmark.hashtags) hashtags.add(hashtag);
    for (const url of bookmark.urls) urls.add(url);
  }
  return {
    notes: Array.from(notes.values()),
    articles: Array.from(articles.values()),
    hashtags: Array.from(hashtags),
    urls: Array.from(urls),
  };
}

/** Returns all the bookmarks of the event */
export function getBookmarks(bookmark: NostrEvent): Bookmarks {
  const hidden = getHiddenBookmarks(bookmark);
  if (hidden) return mergeBookmarks(hidden, getPublicBookmarks(bookmark));
  else return getPublicBookmarks(bookmark);
}

/** Returns the public bookmarks of the event */
export function getPublicBookmarks(bookmark: NostrEvent): Bookmarks {
  return getOrComputeCachedValue(bookmark, BookmarkPublicSymbol, () => parseBookmarkTags(bookmark.tags));
}

/** Checks if the hidden bookmarks are unlocked */
export function isHiddenBookmarksUnlocked<T extends NostrEvent>(bookmark: T): bookmark is T & UnlockedBookmarks {
  return isHiddenTagsUnlocked(bookmark) && Reflect.has(bookmark, BookmarkHiddenSymbol);
}

/** Returns the bookmarks of the event if its unlocked */
export function getHiddenBookmarks<T extends NostrEvent & UnlockedBookmarks>(bookmark: T): Bookmarks;
export function getHiddenBookmarks<T extends NostrEvent>(bookmark: T): Bookmarks | undefined;
export function getHiddenBookmarks<T extends NostrEvent>(bookmark: T): Bookmarks | undefined {
  if (isHiddenBookmarksUnlocked(bookmark)) return bookmark[BookmarkHiddenSymbol];

  //get hidden tags
  const tags = getHiddenTags(bookmark);
  if (!tags) return undefined;

  // parse bookmarks
  const bookmarks = parseBookmarkTags(tags);

  // set cached value
  Reflect.set(bookmark, BookmarkHiddenSymbol, bookmarks);

  return bookmarks;
}

/** Unlocks the hidden bookmarks on a bookmarks event */
export async function unlockHiddenBookmarks(bookmark: NostrEvent, signer: HiddenContentSigner): Promise<Bookmarks> {
  if (isHiddenBookmarksUnlocked(bookmark)) return bookmark[BookmarkHiddenSymbol];

  // unlock hidden tags
  await unlockHiddenTags(bookmark, signer);

  // get hidden bookmarks
  const bookmarks = getHiddenBookmarks(bookmark);
  if (!bookmarks) throw new Error("Failed to unlock hidden bookmarks");

  // notify event store
  notifyEventUpdate(bookmark);

  return bookmarks;
}
