import * as List from "applesauce-common/operations/list";
import { addEventBookmarkTag, removeEventBookmarkTag } from "applesauce-common/operations/tag/bookmarks";
import { TagOperation } from "applesauce-core";
import { AddressPointer, EventPointer } from "applesauce-core/helpers";
import { getReplaceableIdentifier, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { Action } from "../action-hub.js";

function ModifyBookmarkSetEvent(operations: TagOperation[], set: NostrEvent | string, hidden = false): Action {
  const identifier = typeof set === "string" ? set : getReplaceableIdentifier(set);

  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.Bookmarksets, identifier).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = hidden ? modifyHiddenTags(...operations) : modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.Bookmarksets }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

function ModifyBookmarkListEvent(operations: TagOperation[], hidden = false): Action {
  return async ({ factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      user.replaceable(kinds.BookmarkList).$first(1000, undefined),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = hidden ? modifyHiddenTags(...operations) : modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.BookmarkList }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/**
 * An action that adds a note or article to the bookmark list or a bookmark set
 * @param event the event to bookmark
 * @param identifier the "d" tag of the bookmark set or `undefined` for the default bookmark list
 * @param hidden set to true to add to hidden bookmarks
 */
export function BookmarkEvent(
  event: NostrEvent | EventPointer | AddressPointer,
  identifier?: string | NostrEvent,
  hidden?: boolean,
): Action {
  const operation = addEventBookmarkTag(event);

  if (typeof identifier === "string" || identifier?.kind === kinds.Bookmarksets) {
    return ModifyBookmarkSetEvent([operation], identifier, hidden);
  } else if (identifier === undefined || identifier?.kind === kinds.BookmarkList) {
    return ModifyBookmarkListEvent([operation], hidden);
  } else {
    throw new Error(`Event kind ${identifier.kind} is not a bookmark list or bookmark set`);
  }
}

/**
 * An action that removes a note or article from the bookmark list or bookmark set
 * @param event the event to remove from bookmarks
 * @param identifier the "d" tag of the bookmark set or `undefined` for the default bookmark list
 * @param hidden set to true to remove from hidden bookmarks
 */
export function UnbookmarkEvent(
  event: NostrEvent | EventPointer | AddressPointer,
  identifier?: string | NostrEvent,
  hidden?: boolean,
): Action {
  const operation = removeEventBookmarkTag(event);

  if (typeof identifier === "string" || identifier?.kind === kinds.Bookmarksets) {
    return ModifyBookmarkSetEvent([operation], identifier, hidden);
  } else if (identifier === undefined || identifier?.kind === kinds.BookmarkList) {
    return ModifyBookmarkListEvent([operation], hidden);
  } else {
    throw new Error(`Event kind ${identifier.kind} is not a bookmark list or bookmark set`);
  }
}

/** An action that creates a new bookmark list for a user */
export function CreateBookmarkList(bookmarks?: NostrEvent[]): Action {
  return async ({ events, factory, self, user, publish, sign }) => {
    const existing = events.getReplaceable(kinds.BookmarkList, self);
    if (existing) throw new Error("Bookmark list already exists");

    const signed = await factory
      .build(
        { kind: kinds.BookmarkList },
        bookmarks ? modifyPublicTags(...bookmarks.map(addEventBookmarkTag)) : undefined,
      )
      .then(sign);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}

/** An action that creates a new bookmark set for a user */
export function CreateBookmarkSet(
  title: string,
  description: string,
  additional: { image?: string; hidden?: NostrEvent[]; public?: NostrEvent[] },
): Action {
  return async ({ factory, user, publish, sign }) => {
    const signed = await factory
      .build(
        { kind: kinds.BookmarkList },
        List.setTitle(title),
        List.setDescription(description),
        additional.image ? List.setImage(additional.image) : undefined,
        additional.public ? modifyPublicTags(...additional.public.map(addEventBookmarkTag)) : undefined,
        additional.hidden ? modifyHiddenTags(...additional.hidden.map(addEventBookmarkTag)) : undefined,
      )
      .then(sign);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
