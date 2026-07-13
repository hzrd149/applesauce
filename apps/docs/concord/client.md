# The client

`ConcordClient` is the entry point for a logged-in user. There is **one instance per user**, and it owns everything: the shared relay pool, the encrypted event store, every joined community, the user's community list, and the direct-invite inbox watcher.

## Creating a client

A client needs a signer and a [RelayPool](/loading/relays/pool). Everything else has a sensible default.

```ts
import { ConcordClient } from "applesauce-concord/client";
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();
const client = new ConcordClient({ signer, pool });
```

For a real app you'll usually pass a few more options:

```ts
const client = new ConcordClient({
  signer,
  pool,
  storage,          // persist memberships + keys across reloads (see /concord/storage)
  uploader,         // encrypt + upload images and file attachments
  relays: ["wss://relay.example.com"], // fallback relays for communities that define none
});
```

## Starting and stopping

Nothing happens until you call `start()`. It resolves the user's pubkey, restores their communities from local storage (instant, offline-safe), then reconciles with the copy published to relays.

```ts
await client.start();
// ... the app is running ...
client.stop(); // on logout — tears down every subscription and community
```

`start()` is deliberately **side-effect-free**: it never touches the signer for a signature or publishes anything on its own. The user's first sync is pure reading. Membership changes only publish when the user explicitly joins, leaves, or creates a community (or when you opt into auto-save — see [below](#automatic-behaviour)).

## Reading the joined communities

`communities$` emits the current folded state of every joined community. This is what you render as a server list.

```ts
client.communities$.subscribe((communities) => {
  for (const c of communities) {
    console.log(c.material.community_id, c.metadata?.name, c.members.size);
  }
});
```

To act on one community, grab its engine:

```ts
const community = client.getCommunity(communityId);
```

See [Communities](/concord/community) for everything you can do with it.

## Watching status

`status$` is a single flat snapshot of the whole client — useful for a global connection indicator.

```ts
client.status$.subscribe((s) => {
  // s.phase: "idle" | "starting" | "ready"
  // s.communities, s.live, s.syncing
  // s.connected, s.authenticated
});
```

`phase$` on its own tracks the lifecycle if that's all you need.

## Creating a community

```ts
const community = await client.createNewCommunity(
  "My Community",
  "A place to hang out",
  ["wss://relay.example.com"],
);
```

This mints the genesis events, publishes them, adds you as the owner, and republishes your community list. It returns the live `ConcordCommunity` engine, ready to act on immediately.

## Joining a community

From an invite link:

```ts
const community = await client.joinByLink(inviteUrl);
```

From a [direct invite](/concord/invites) bundle (e.g. one surfaced by the `InviteWatcher`):

```ts
const community = await client.joinByBundle(invite.bundle);
```

Both validate the invite against the owner before joining, publish your attributed Join, and update your community list. If you're already a member they return the existing engine.

## Leaving a community

```ts
await client.leave(communityId);
```

This publishes your Leave, tears the community down, and **tombstones** the membership in your community list so the leave propagates to your other devices (a plain removal would merge back as "still joined").

## The community list

Your set of memberships is itself a self-encrypted Nostr event (kind 13302) so it syncs across devices. The client exposes it reactively:

```ts
client.communityList$.subscribe((list) => {
  // undefined before start / before it loads
  // locked until unlocked (see below)
});
```

By default the list arrives **locked** — the client won't invoke the user's signer to decrypt it without intent. Either unlock it on demand:

```ts
const list = await firstValueFrom(client.communityList$);
await list?.unlock(signer);
```

...or turn on `autoUnlock` (see below) to decrypt it automatically as it arrives.

`communityListDirty$` is `true` when your in-memory memberships have diverged from the last copy published to relays (an epoch caught up during sync, say). Show an "unpublished changes" indicator off it, or let auto-save handle it.

## Automatic behaviour

Several signer-touching behaviours are **off by default** so startup stays quiet. Turn them on per app:

| Option | Default | Effect |
| --- | --- | --- |
| `autoUnlock` | `false` | Decrypt the community/invite lists and incoming direct invites automatically as they arrive. |
| `autoAuthenticate` | `false` | NIP-42-authenticate as the user on inbox relays when they challenge. |
| `autoSaveCommunityList` | `false` | Publish an updated list after a sync when memberships changed locally. |
| `watchDirectInvites` | `true` | Watch the user's inbox for [direct invites](/concord/invites) during `start()`. |

Explicit `joinByLink` / `leave` / `createNewCommunity` always publish the list regardless of `autoSaveCommunityList` — those are the sanctioned points to sign it.

## Direct invites

When `watchDirectInvites` is on (the default), the client runs an [`InviteWatcher`](/concord/invites) over the user's inbox. Subscribe to it once it exists:

```ts
client.directInviteWatcher$.subscribe((watcher) => {
  watcher?.pendingCount$.subscribe((n) => console.log(`${n} pending invites`));
});
```

A direct invite for a community you're **already in** has its channel keys folded in automatically. A direct invite to a **new** community is left for the app to accept via `joinByBundle` — see [Invites](/concord/invites).
