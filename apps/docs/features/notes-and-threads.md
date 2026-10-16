---
description: Read, thread, and reply to short text notes
---

# Notes & Threads

Short text notes are kind 1 events, and replies to them are notes too. Replies point at their parent and the thread root with marked `e` tags (NIP-10), so applesauce can rebuild a conversation from the notes in the store.

## Reading a note

The `Note` cast exposes a note's thread references and the events around it. Invalid events are dropped by `castTimelineStream`, so only kind 1 notes come through.

```ts
const notes = use$(() => store.timeline({ kinds: [1] }).pipe(castTimelineStream(Note, store)), []);

note.isRoot; // true when the note replies to nothing
note.isReply; // true when the note has a reply reference
note.references; // { root?: { e, a }, reply?: { e, a } }
note.quotePointers; // EventPointer[] from "q" tags
```

`note.replies$`, `comments$`, `reactions$`, `zaps$`, and `shares$` subscribe to related events already in the store and cast them.

## Walking up a thread

`threadRoot$` and `replyingTo$` resolve the root and parent events. They use `store.event()`, so a configured [event loader](/loading/loaders/event-loader) fetches missing events.

```ts
const root = use$(note.threadRoot$);
const parent = use$(note.replyingTo$);
```

## Building a thread tree

`store.thread(root)` returns a `Thread` built from the root and every note tagging it. `thread.root` is the root item and `thread.all` maps each event's UID to its item, and each item links its `parent` and direct `replies`.

```ts
const thread = use$(() => store.thread(pointer), [pointer.id]);

function render(item: ThreadItem) {
  return [item.event, ...[...item.replies].flatMap(render)];
}
```

`store.thread()` is shorthand for `store.model(ThreadModel, root)`. Use the model directly to include other kinds, such as `{ kinds: [1, 1111] }`.

## Listing direct replies

`RepliesModel` returns only the direct replies to an event. For a note it includes both kind 1 replies and kind 1111 [comments](/features/comments), and for other kinds only comments.

```ts
const replies = use$(() => store.model(RepliesModel, event), [event.id]);
```

Pass a kind list as the second argument to override this; `note.replies$` passes `[1]`.

## Writing notes and replies

`NoteFactory.create()` builds a note, and `NoteFactory.reply()` adds the root and reply `e` tags and copies the parent's `p` tags so everyone in the thread is notified.

```ts
const note = await NoteFactory.create("hello #nostr").sign(signer);

const reply = await NoteFactory.reply(parent, "nice!").mention(pubkey).sign(signer);
```

`reply()` throws when the parent is not a kind 1 note. Reply to other kinds with [`CommentFactory`](/features/comments).

The builder also has `.subject()`, `.addHashtag()`, `.hashtags()`, and `.zapSplit()`. See [common factories](/creating/factory/common-factories) for signing and publishing.

## Helpers

- `getNip10References(event)` parses and caches the `root` and `reply` pointers, including legacy positional `e` tags
- `interpretThreadTags(tags)` returns the raw root and reply tags
- `getEventPointerFromThreadTag(tag)` builds an `EventPointer` from a thread `e` tag and throws without an id
- `setThreadParent(parent)` and `includePubkeyNotificationTags(parent)` are the operations behind `NoteFactory.reply()`

## Best Practices

- Load replies with a relay subscription or loader first, since `replies$`, `store.thread()`, and `RepliesModel` only read the store
- Use `NoteFactory.reply()` for kind 1 parents and `CommentFactory.reply()` for everything else
- Use `RepliesModel` for a flat list of direct replies and `store.thread()` for a nested conversation
- Configure an event loader on the store so `threadRoot$` and `replyingTo$` can fetch parents that aren't loaded
