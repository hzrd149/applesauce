# Communities

`ConcordCommunity` is the reactive engine for a **single** community. The [client](/concord/client) creates and owns these — you get one with `client.getCommunity(communityId)`. This page covers reading a community's state and the day-to-day messaging actions. Management actions live on `community.admin`; [Channels](/concord/channels), [Moderation](/concord/moderation), and [Invites](/concord/invites) cover those workflows.

## Reading community state

Each slice of the community is its own observable, and each only emits when **that** slice changes.

```ts
community.metadata$.subscribe((m) => m?.name); // name, icon, banner, description
community.channels$.subscribe(render);         // live channels
community.roles$.subscribe(render);            // defined roles
community.members$.subscribe(render);          // Set of member pubkeys
community.banlist$.subscribe(render);          // Set of banned pubkeys
community.inviteLinks$.subscribe(render);      // non-empty ⇒ the community is Public
```

Prefer these over `state$`, the aggregate of all of them. `state$` re-emits on **any**
change — including a chat message in any channel, which moves the presence-derived
member set — so a roles UI built on `state$` re-renders on every message. `roles$`
doesn't.

```ts
community.state$.subscribe((state) => state.dissolved); // the whole snapshot
```

Because it's folded from the encrypted streams, state fills in as sync catches up — cached history renders immediately, then live events refine it.

## Watching sync status

Each community walks its epochs to the tip before going live. Track that with `status$`:

```ts
community.status$.subscribe((s) => {
  // s.phase: "idle" | "syncing" | "live" | "removed" | "error" | "dissolved"
  // s.epoch: current root epoch
  // s.connected, s.authenticated
  // s.error: last sync error or null
});
```

The individual signals (`phase$`, `epoch$`, `connected$`, `authenticated$`, `dissolved$`, `error$`) are exposed too if you'd rather react to one.

## Reading messages

Messages live in per-channel [RumorStores](/core/event-store). Concord folds no chat logic — you read the store with the **standard applesauce API**, so any model or timeline you'd use elsewhere works here.

```ts
// A timeline of chat messages (kind 9) in a channel
community.channelStore(channelId)
  .timeline([{ kinds: [9] }])
  .subscribe((messages) => render(messages));
```

The control and guestbook planes are stores too, if you want the raw membership log or control editions:

```ts
community.guestbookStore.timeline([{}]);  // Joins / Leaves / Kicks
community.controlStore.timeline([{}]);    // control editions
```

## Sending messages

`sendMessage` handles the common case: text, an optional reply, file attachments, and custom emoji.

```ts
await community.sendMessage(channelId, "gm everyone");

// Reply
await community.sendMessage(channelId, "welcome!", { id: msgId, author: msgAuthor });
```

Attachments require an `uploader` on the [client](/concord/client). Each file is encrypted, uploaded, and referenced in the message:

```ts
await community.sendMessage(channelId, "check this out", undefined, [file]);
```

Pass `onUploadProgress` to show per-send attachment progress without global state:

```ts
await community.sendMessage(channelId, text, undefined, files, emojis, {
  onUploadProgress: ({ total, done, phase }) => {
    console.log(`${phase} file ${done + 1} of ${total}`);
  },
});
```

`done` counts completed files. Once `done === total`, the media work is finished and the remaining wait is the message publish.

### Reactions, edits, deletes

```ts
await community.react(channelId, { id, author }, "🔥");
await community.editMessage(channelId, messageId, "fixed typo");
await community.deleteMessage(channelId, messageId);
```

### Threads

Concord speaks [NIP-7D](https://github.com/nostr-protocol/nips/blob/master/7D.md) forum threads:

```ts
await community.sendThread(channelId, "Feature ideas", "Drop your suggestions here");
await community.replyToThread(channelId, { id: threadId, author }, "How about dark mode?");
```

### Anything else

To publish a non-standard event to a channel, `sendEvent` takes a factory promise, a template, or a signed event and applies the channel/epoch binding for you:

```ts
await community.sendEvent(channelId, someFactory.create(...));
```

## Managing the community

Owner/admin actions are grouped under `community.admin`:

```ts
await community.admin.editMetadata({ name: "New Name", description: "..." });
await community.admin.setCommunityImage("icon", iconFile);
await community.admin.removeCommunityImage("banner");
```

Invite links also have a scoped admin surface:

```ts
const invite = await community.admin.invites.create({
  base: "https://app.example",
  label: "Reddit",
});

await community.admin.invites.revoke(invite);
```

Creating and managing channels, roles, members, and invites is covered in [Channels](/concord/channels), [Moderation](/concord/moderation), and [Invites](/concord/invites).

## Permissions

Before showing an admin control, check whether the current user is allowed to use it:

```ts
import { PERM } from "applesauce-concord";

if (community.canDo(PERM.MANAGE_CHANNELS)) {
  // show the "create channel" button
}
```

`standingOf(pubkey)` returns a member's resolved rank if you need to compare two members (e.g. can this moderator act on that one). See [Moderation](/concord/moderation) for the permission model.

## Dissolving

Only the owner can dissolve a community. It flips `state.dissolved` for every member.

```ts
await community.admin.dissolve();
```
