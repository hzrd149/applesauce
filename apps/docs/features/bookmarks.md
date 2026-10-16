---
description: Read, add, and remove a user's bookmarked notes and articles
---

# Bookmarks

Bookmarks let users save notes and articles to come back to later. Each user has one bookmark list (kind 10003) and can keep any number of named bookmark sets (kind 30003), with entries that can be public or hidden.

## Reading bookmarks

`user.bookmarks$` loads the user's bookmark list from their outboxes and casts it to `BookmarksList`. `notes$` and `articles$` resolve the bookmarked events as `Note` and `Article` casts.

```ts
const bookmarks = use$(user.bookmarks$);
const notes = use$(bookmarks?.notes$);
const articles = use$(bookmarks?.articles$);

bookmarks?.bookmarks; // (EventPointer | AddressPointer)[]
```

`notes` and `articles` hold the raw pointers when you want to load or render them yourself. Events that aren't in the store yet are left out until they load.

**Example:** [Bookmarks Manager](https://applesauce.build/examples/#/example/bookmarks/manager)

## Unlocking hidden bookmarks

Hidden bookmarks stay encrypted until the user's signer decrypts them. `hidden$`, `hiddenNotes$`, and `hiddenArticles$` emit `undefined` while locked and update once unlocked.

```ts
if (bookmarks.hasHidden && !bookmarks.unlocked) await bookmarks.unlock(signer);

const hiddenNotes = use$(bookmarks.hiddenNotes$);
```

Use [encrypted content caching](/apps/encryption/caching) to keep the decrypted entries across reloads.

## Bookmark sets

`BookmarksSet` has the same API as `BookmarksList`. Load a set by its `d` identifier.

```ts
const set = use$(
  () => eventStore.replaceable({ kind: 30003, pubkey, identifier }).pipe(castEventStream(BookmarksSet, eventStore)),
  [pubkey, identifier],
);
```

## Adding and removing bookmarks

`BookmarkEvent` and `UnbookmarkEvent` take an event or pointer, an optional set, and a hidden flag. Leave the set `undefined` to use the bookmark list; pass a `d` identifier or set event to target a set.

```ts
await actions.run(BookmarkEvent, note);
await actions.run(BookmarkEvent, article, "reading-list", true); // hidden, in a set
await actions.run(UnbookmarkEvent, note);
```

`CreateBookmarkList(events?)` creates the list and throws if one exists. `CreateBookmarkSet(title, description, { image, public, hidden })` creates a new set.

## Building bookmark events

`BookmarkListFactory` and `BookmarkSetFactory` from `applesauce-common/factories` build the events directly. Both have `bookmarkEvent()`, `bookmarkUrl()`, and `bookmarkHashtag()`, each with an `unbookmark` counterpart and a `hidden` flag.

```ts
const signed = await BookmarkListFactory.modify(list.event).bookmarkEvent(note).sign(signer);
```

The casts only read note and article bookmarks, so read URL and hashtag entries with `getListTags(event)` from `applesauce-common/helpers`.

## Helpers

- `getBookmarks(event)` returns the public bookmark pointers
- `getHiddenBookmarks(event)` returns the hidden pointers, or `undefined` while locked
- `unlockHiddenBookmarks(event, signer)` decrypts hidden bookmarks and notifies the store
- `isValidBookmarkList(event)` and `isValidBookmarkSet(event)` check the kind

## Best Practices

- Use `BookmarkEvent` and `UnbookmarkEvent` instead of rebuilding the list, so bookmarks added by other clients are kept
- Check `hasHidden` before showing an unlock button, since most lists have no hidden entries
- Load bookmarked events with an [event loader](/loading/loaders/event-loader) so `notes$` and `articles$` fill in
