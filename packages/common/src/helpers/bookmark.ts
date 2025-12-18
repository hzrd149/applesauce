import { getOrComputeCachedValue, isATag, isETag, notifyEventUpdate, processTags } from "applesauce-core/helpers";
import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { getHiddenTags, isHiddenTagsUnlocked, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import {
  AddressPointer,
  EventPointer,
  getAddressPointerFromATag,
  getEventPointerFromETag,
  getReplaceableAddressFromPointer,
  isAddressPointer,
  isEventPointer,
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

export type BookmarkPointer = EventPointer | AddressPointer;

/** Type for unlocked bookmarks events */
export type UnlockedBookmarks = {
  [BookmarkHiddenSymbol]: BookmarkPointer[];
};

/** Parses an array of tags into a {@link Bookmarks} object */
export function parseBookmarkTags(tags: string[][]): BookmarkPointer[] {
  return processTags(tags, (t) => {
    if (isETag(t)) return getEventPointerFromETag(t) ?? undefined;
    if (isATag(t)) {
      const pointer = getAddressPointerFromATag(t) ?? undefined;
      // Ensure the address pointer is a long form article
      if (pointer?.kind !== kinds.LongFormArticle) return undefined;
      return pointer;
    }
    return undefined;
  });
}

/** Merges any number of {@link Bookmarks} objects */
export function mergeBookmarks(...bookmarks: (BookmarkPointer[] | undefined)[]): BookmarkPointer[] {
  const notes: Map<string, EventPointer> = new Map();
  const articles = new Map<string, AddressPointer>();

  for (const pointer of bookmarks.flat()) {
    if (isEventPointer(pointer)) {
      const existing = notes.get(pointer.id);
      if (existing) notes.set(pointer.id, mergeEventPointers(existing, pointer));
      else notes.set(pointer.id, pointer);
    } else if (isAddressPointer(pointer)) {
      const address = getReplaceableAddressFromPointer(pointer);
      const existing = articles.get(address);
      if (existing) articles.set(address, mergeAddressPointers(existing, pointer));
      else articles.set(address, pointer);
    }
  }
  return [...notes.values(), ...articles.values()];
}

/** Returns the bookmarks of the event */
export function getBookmarks(bookmark: NostrEvent): BookmarkPointer[] {
  return getOrComputeCachedValue(bookmark, BookmarkPublicSymbol, () => parseBookmarkTags(bookmark.tags));
}

/** Checks if the hidden bookmarks are unlocked */
export function isHiddenBookmarksUnlocked<T extends NostrEvent>(bookmark: T): bookmark is T & UnlockedBookmarks {
  return (
    isHiddenTagsUnlocked(bookmark) && (BookmarkHiddenSymbol in bookmark || getHiddenBookmarks(bookmark) !== undefined)
  );
}

/** Returns the bookmarks of the event if its unlocked */
export function getHiddenBookmarks<T extends NostrEvent & UnlockedBookmarks>(bookmark: T): BookmarkPointer[];
export function getHiddenBookmarks<T extends NostrEvent>(bookmark: T): BookmarkPointer[] | undefined;
export function getHiddenBookmarks<T extends NostrEvent>(bookmark: T): BookmarkPointer[] | undefined {
  if (BookmarkHiddenSymbol in bookmark) return bookmark[BookmarkHiddenSymbol] as BookmarkPointer[];

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
export async function unlockHiddenBookmarks(
  bookmark: NostrEvent,
  signer: HiddenContentSigner,
): Promise<BookmarkPointer[]> {
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
