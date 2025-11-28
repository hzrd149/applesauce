import { Model } from "applesauce-core/event-store";
import { kinds } from "applesauce-core/helpers/event";
import { watchEventUpdates } from "applesauce-core/observable";
import { map } from "rxjs/operators";

import { Bookmarks, getBookmarks, getHiddenBookmarks, getPublicBookmarks } from "../helpers/bookmark.js";

/** A model that returns all the bookmarks of a user */
export function UserBookmarkModel(pubkey: string): Model<Bookmarks | undefined> {
  return (events) =>
    events.replaceable(kinds.Mutelist, pubkey).pipe(
      // listen for event updates (hidden tags unlocked)
      watchEventUpdates(events),
      // Get all bookmarks
      map((event) => event && getBookmarks(event)),
    );
}

/** A model that returns all the public bookmarks of a user */
export function UserPublicBookmarkModel(pubkey: string): Model<Bookmarks | undefined> {
  return (events) =>
    events.replaceable(kinds.Mutelist, pubkey).pipe(map((event) => event && getPublicBookmarks(event)));
}

/** A model that returns all the hidden bookmarks of a user */
export function UserHiddenBookmarkModel(pubkey: string): Model<Bookmarks | null | undefined> {
  return (events) =>
    events.replaceable(kinds.Mutelist, pubkey).pipe(
      // listen for event updates (hidden tags unlocked)
      watchEventUpdates(events),
      // Get hidden bookmarks
      map((event) => event && (getHiddenBookmarks(event) ?? null)),
    );
}
