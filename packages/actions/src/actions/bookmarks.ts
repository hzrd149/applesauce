import * as List from "applesauce-common/operations/list";
import { addEventBookmarkTag, removeEventBookmarkTag } from "applesauce-common/operations/tag/bookmarks";
import { EventTemplate, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { Action } from "../action-hub.js";

/**
 * An action that adds a note or article to the bookmark list or a bookmark set
 * @param event the event to bookmark
 * @param identifier the "d" tag of the bookmark set or `undefined` for the default bookmark list
 * @param hidden set to true to add to hidden bookmarks
 */
export function BookmarkEvent(event: NostrEvent, identifier?: string | NostrEvent, hidden = false): Action {
  return async function* ({ events, factory, self }) {
    let draft: EventTemplate;
    const operation = addEventBookmarkTag(event);

    if (typeof identifier === "string" || identifier?.kind === kinds.Bookmarksets) {
      const list =
        typeof identifier === "string" ? events.getReplaceable(kinds.Bookmarksets, self, identifier) : identifier;
      if (list && list.kind !== kinds.Bookmarksets) throw new Error("Event is not a bookmark set");

      // Modify or build new event bookmark set
      draft = list
        ? await factory.modifyTags(list, hidden ? { hidden: operation } : operation)
        : await factory.build(
            { kind: kinds.Bookmarksets },
            hidden ? modifyHiddenTags(operation) : modifyPublicTags(operation),
          );
    } else if (identifier === undefined || identifier?.kind === kinds.BookmarkList) {
      const list = identifier ? identifier : events.getReplaceable(kinds.BookmarkList, self);
      if (list && list.kind !== kinds.BookmarkList) throw new Error("Event is not a bookmark list");

      // Modify or build new event bookmark list
      draft = list
        ? await factory.modifyTags(list, hidden ? { hidden: operation } : operation)
        : await factory.build(
            { kind: kinds.BookmarkList },
            hidden ? modifyHiddenTags(operation) : modifyPublicTags(operation),
          );
    } else {
      throw new Error(`Event kind ${identifier.kind} is not a bookmark list or bookmark set`);
    }

    yield await factory.sign(draft);
  };
}

/**
 * An action that removes a note or article from the bookmark list or bookmark set
 * @param event the event to remove from bookmarks
 * @param identifier the "d" tag of the bookmark set or `undefined` for the default bookmark list
 * @param hidden set to true to remove from hidden bookmarks
 */
export function UnbookmarkEvent(event: NostrEvent, identifier?: string | NostrEvent, hidden = false): Action {
  return async function* ({ events, factory, self }) {
    let list: NostrEvent | undefined;
    const operation = removeEventBookmarkTag(event);
    if (typeof identifier === "string" || identifier?.kind === kinds.Bookmarksets) {
      list = typeof identifier === "string" ? events.getReplaceable(kinds.Bookmarksets, self, identifier) : identifier;
    } else if (identifier === undefined || identifier?.kind === kinds.BookmarkList) {
      list = identifier ? identifier : events.getReplaceable(kinds.BookmarkList, self);
      if (!list) return;
    } else {
      throw new Error(`Event kind ${identifier.kind} is not a bookmark list or bookmark set`);
    }

    // If no list is found, return
    if (!list) return;

    const draft = await factory.modifyTags(list, hidden ? { hidden: operation } : operation);
    yield await factory.sign(draft);
  };
}

/** An action that creates a new bookmark list for a user */
export function CreateBookmarkList(bookmarks?: NostrEvent[]): Action {
  return async function* ({ events, factory, self }) {
    const existing = events.getReplaceable(kinds.BookmarkList, self);
    if (existing) throw new Error("Bookmark list already exists");

    const draft = await factory.build(
      { kind: kinds.BookmarkList },
      bookmarks ? modifyPublicTags(...bookmarks.map(addEventBookmarkTag)) : undefined,
    );
    yield await factory.sign(draft);
  };
}

/** An action that creates a new bookmark set for a user */
export function CreateBookmarkSet(
  title: string,
  description: string,
  additional: { image?: string; hidden?: NostrEvent[]; public?: NostrEvent[] },
): Action {
  return async function* ({ factory }) {
    const draft = await factory.build(
      { kind: kinds.BookmarkList },
      List.setTitle(title),
      List.setDescription(description),
      additional.image ? List.setImage(additional.image) : undefined,
      additional.public ? modifyPublicTags(...additional.public.map(addEventBookmarkTag)) : undefined,
      additional.hidden ? modifyHiddenTags(...additional.hidden.map(addEventBookmarkTag)) : undefined,
    );
    yield await factory.sign(draft);
  };
}
