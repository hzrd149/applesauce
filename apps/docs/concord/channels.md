# Channels

Channels are where messages live. A community can have **public** channels (readable by every member) and **private** channels (readable only by members who hold the channel key). Both are created and managed off the [community engine](/concord/community).

## Creating a channel

```ts
// A public text channel
const channelId = await community.admin.createChannel("general");

// A private text channel
const privateId = await community.admin.createChannel("mods-only", { private: true });

// A voice channel
const voiceId = await community.admin.createChannel("lounge", { voice: true });
```

Creating a private channel mints and persists its key locally. Requires `MANAGE_CHANNELS` — see [Moderation](/concord/moderation).

## Deleting a channel

```ts
await community.admin.deleteChannel(channelId);
```

The channel is flagged deleted in the community state; already-synced messages stay readable in the store.

## Reading channel messages

Public and private channels are read the same way — through the channel's [RumorStore](/core/event-store):

```ts
community.channelStore(channelId)
  .timeline([{ kinds: [9] }])
  .subscribe((messages) => render(messages));
```

For a private channel you can only read messages if you hold its key. If you don't, the store simply stays empty — nothing decodes.

## How private channels sync

Each private channel keys and rotates independently of the community, so it runs on its own sub-engine (`ConcordPrivateChannel`). You don't construct these — the community spawns one for every private channel you hold a key for and disposes it when the channel is deleted or you're removed. You just read `channelStore(channelId)` as usual.

## Granting access to a private channel

To **add** someone to a private channel, hand them its current key via a [direct invite](/concord/invites). This is the correct way to onboard a member — no rotation, no epoch bump:

```ts
await community.admin.grantChannelAccess(channelId, memberPubkey);
```

The grant is gift-wrapped to that member and best-effort published to the community relays, where their `InviteWatcher` is listening. If they're already in the community, the client folds the key in automatically and their channel starts syncing.

Requires `MANAGE_CHANNELS`.

## Removing access (rotating)

To **remove** someone, rotate the channel key. The new key is delivered only to the members you keep, so the excluded can no longer read new messages:

```ts
await community.admin.rotateChannel(channelId, {
  keep: [alicePubkey, bobPubkey],
  exclude: [malloryPubkey],
});
```

Rotating requires `MANAGE_CHANNELS`, and to exclude a specific member you must also **strictly outrank** them (an under-ranked channel manager can't sever someone above them). Pass the channel's actual membership as `keep` — anyone omitted loses access.

## Leaving a private channel yourself

Leaving is purely local: you drop your copy of the key and stop syncing. The remaining members are undisturbed (no rotation).

```ts
await community.leaveChannel(channelId);
```

Messages already synced to your cache stay readable; new channel traffic no longer decodes.
