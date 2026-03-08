import { BookmarkListFactory, BookmarkSetFactory } from "applesauce-common/factories";
import { AddressPointer, EventPointer } from "applesauce-core/helpers";
import { getReplaceableIdentifier, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { Action, ActionContext } from "../action-runner.js";

async function modifyBookmarkList({ user }: ActionContext): Promise<[BookmarkListFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.BookmarkList).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? BookmarkListFactory.modify(event) : BookmarkListFactory.create(), outboxes];
}

async function modifyBookmarkSet(
  identifier: string,
  { user }: ActionContext,
): Promise<[BookmarkSetFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.Bookmarksets, identifier).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? BookmarkSetFactory.modify(event) : BookmarkSetFactory.create(), outboxes];
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
  if (typeof identifier === "string" || identifier?.kind === kinds.Bookmarksets) {
    const id = typeof identifier === "string" ? identifier : getReplaceableIdentifier(identifier!);
    return async (context) => {
      const [factory, outboxes] = await modifyBookmarkSet(id, context);
      const signed = await factory.bookmarkEvent(event, hidden).sign(context.signer);
      await context.publish(signed, outboxes);
    };
  } else if (identifier === undefined || identifier?.kind === kinds.BookmarkList) {
    return async (context) => {
      const [factory, outboxes] = await modifyBookmarkList(context);
      const signed = await factory.bookmarkEvent(event, hidden).sign(context.signer);
      await context.publish(signed, outboxes);
    };
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
  if (typeof identifier === "string" || identifier?.kind === kinds.Bookmarksets) {
    const id = typeof identifier === "string" ? identifier : getReplaceableIdentifier(identifier!);
    return async (context) => {
      const [factory, outboxes] = await modifyBookmarkSet(id, context);
      const signed = await factory.unbookmarkEvent(event, hidden).sign(context.signer);
      await context.publish(signed, outboxes);
    };
  } else if (identifier === undefined || identifier?.kind === kinds.BookmarkList) {
    return async (context) => {
      const [factory, outboxes] = await modifyBookmarkList(context);
      const signed = await factory.unbookmarkEvent(event, hidden).sign(context.signer);
      await context.publish(signed, outboxes);
    };
  } else {
    throw new Error(`Event kind ${identifier.kind} is not a bookmark list or bookmark set`);
  }
}

/** An action that creates a new bookmark list for a user */
export function CreateBookmarkList(bookmarks?: NostrEvent[]): Action {
  return async ({ user, signer, publish }) => {
    const existing = await user.replaceable(kinds.BookmarkList).$first(1000, undefined);
    if (existing) throw new Error("Bookmark list already exists");

    let factory = BookmarkListFactory.create();
    if (bookmarks) factory = bookmarks.reduce((f, b) => f.bookmarkEvent(b), factory);
    const signed = await factory.sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}

/** An action that creates a new bookmark set for a user */
export function CreateBookmarkSet(
  title: string,
  description: string,
  additional: { image?: string; hidden?: NostrEvent[]; public?: NostrEvent[] },
): Action {
  return async ({ signer, user, publish }) => {
    let factory = BookmarkSetFactory.create().title(title).description(description);
    if (additional.image) factory = factory.image(additional.image);
    if (additional.public) factory = additional.public.reduce((f, b) => f.bookmarkEvent(b), factory);
    if (additional.hidden) factory = additional.hidden.reduce((f, b) => f.bookmarkEvent(b, true), factory);
    const signed = await factory.sign(signer);

    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
