---
description: Comment on any event, address, or external content with threaded replies
---

# Comments

Comments are kind 1111 events that can reply to any event, addressable event, or external content like a URL (NIP-22). Each comment tags both the thread root (uppercase `E`/`A`/`I` tags) and the item it replies to (lowercase tags), so nested replies stay attached to the original content.

## Reading comments

`store.comments(parent)` returns every comment replying directly to an event or `CommentPointer`. Cast them with `Comment` to read their pointers and engagement.

```ts
const comments = use$(() => store.comments(article.event).pipe(castTimelineStream(Comment, store)), [article.id]);
```

`store.comments()` is shorthand for `store.model(CommentsModel, parent)`. `Note` and `Torrent` casts also expose `comments$`.

## Walking a comment thread

The `Comment` cast resolves the root content and the parent being replied to. Both resolve to `undefined` for external roots like URLs.

```ts
comment.rootPointer; // CommentPointer: { type: "event" | "address" | "external", ... }
comment.replyPointer;

const root = use$(comment.root$);
const parent = use$(comment.parent$);
const replies = use$(comment.replies$); // nested Comment casts
```

`comment.reactions$` and `comment.zaps$` return the comment's [reactions](/features/reactions-and-reposts) and [zaps](/features/zaps).

## Posting a comment

The `CreateComment` action signs a comment and publishes it to the parent author's inboxes and the user's outboxes.

```ts
await actions.run(CreateComment, parent, "Great post!");
```

To build the event yourself, use `CommentFactory`. `create()` and `reply()` take a parent event, rumor, or `CommentPointer`, and `.group()` scopes the comment to a NIP-29 group.

```ts
const comment = await CommentFactory.create(parent, "Great post!").addHashtag("nostr").sign(signer);
```

Pass the full comment event when replying to a comment, since a pointer can't carry the root tags. `setParent()` throws when given a pointer to a comment.

## Helpers

- `getCommentRootPointer(comment)` and `getCommentReplyPointer(comment)` parse and cache the root and reply `CommentPointer`
- `isValidComment(event)` checks for kind 1111 with both pointers, which the cast requires
- `isCommentEventPointer`, `isCommentAddressPointer`, and `isCommentExternalPointer` narrow a `CommentPointer`
- `createCommentTagsForEvent(parent)` and `createCommentTagsFromCommentPointer(pointer, root)` build the tags

**Example:** [Comment feed](https://applesauce.build/examples/#/example/comment/feed)

## Best Practices

- Use comments to reply to anything except kind 1 notes, which use [`NoteFactory.reply()`](/features/notes-and-threads)
- Prefer `CreateComment` over the factory so the parent's author sees the reply
- Load comments from relays with a `#e`, `#a`, or `#i` filter before reading them, since the model only reads the store
