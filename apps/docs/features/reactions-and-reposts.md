---
description: Read and publish reactions and reposts of any event
---

# Reactions & Reposts

Reactions are kind 7 events whose content is an emoji, `+` for a like, or `-` for a dislike (NIP-25). They tag the reacted-to event with `e` (or `a` for addressable events) and its author with `p`. Reposts share an event with your followers: kind 6 for notes and kind 16 for every other kind (NIP-18).

## Reading reactions

`store.reactions(event)` returns the reactions to an event, including every version of an addressable event. `Note`, `Article`, `Comment`, `Share`, and `Torrent` casts expose the same list as `reactions$`.

```ts
const reactions = use$(note.reactions$);

reaction.content; // "+" when empty
reaction.emoji; // custom emoji { shortcode, url } for ":shortcode:" content
reaction.reactedPointer; // address pointer, or event pointer
const target = use$(reaction.reactedTo$);
```

`store.reactions()` is shorthand for `store.model(ReactionsModel, event)` and returns raw events, so pipe it through `castTimelineStream(Reaction, store)` to cast them.

## Loading reactions from relays

Models only read the store. Use the [reactions loader](/loading/loaders/reactions-loader) to fetch reactions for an event, which queries `#e` for regular events and `#a` for addressable ones.

```ts
reactionsLoader(note.event).subscribe((event) => store.add(event));
```

## Reacting to an event

`ReactionFactory` tags the event, its author, its kind, and its address when addressable. Pass an `Emoji` object to react with a custom emoji, which also adds the `emoji` tag.

```ts
const like = await ReactionFactory.like(note.event).sign(signer);
const fire = await ReactionFactory.create(note.event, "🔥").sign(signer);
const custom = await ReactionFactory.create(note.event, { shortcode: "wave", url }).sign(signer);
```

## Reading reposts

The `Share` cast reads either kind of repost. `note.shares$` and `stream.shares$` return the reposts of an event, backed by `SharesModel`.

```ts
share.sharedKind; // kind of the shared event
share.sharedPointer; // address pointer, or event pointer
share.embedded; // the shared event from the content, when present and verified
const shared = use$(share.shared$);
```

## Reposting an event

`ShareFactory.create()` picks kind 6 or 16 from the shared event's kind, embeds the event in the content, and adds the reference tags.

```ts
const repost = await ShareFactory.create(note.event).sign(signer);
```

## Helpers

- `getReactionEventPointer(event)` and `getReactionAddressPointer(event)` read the reacted-to event from the first `e` or `a` tag, with author and relay hints from the `p` tag
- `getReactionEmoji(event)` returns the custom emoji for a `:shortcode:` reaction
- `getSharedEventPointer`, `getSharedAddressPointer`, and `getEmbededSharedEvent` read reposts, and `isValidShare` validates them

**Example:** [Reactions timeline](https://applesauce.build/examples/#/example/feed/reactions-timeline)

## Best Practices

- Count `+` and empty reactions as likes and `-` as dislikes, and render other content as an emoji
- Render custom emojis from `reaction.emoji`, since the content is only a `:shortcode:`
- Prefer `share.embedded` before loading `shared$`, since it avoids a relay request
