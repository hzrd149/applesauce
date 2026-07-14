# Invites

There are two ways to bring someone into a community: a shareable **invite link**, or a **direct invite** gift-wrapped to one person's inbox. Direct invites are also how private-channel keys are delivered.

## Invite links

Create a link off the [community engine](/concord/community). Pass the base URL your app redeems links at:

```ts
const url = await community.admin.createInvite("https://myapp.example/join");
// share `url` anywhere
```

Creating a link registers it into the community, which marks the community as **public** (link-joinable). Requires `CREATE_INVITE`.

Redeem a link on the [client](/concord/client):

```ts
const community = await client.joinByLink(url);
```

`joinByLink` fetches the invite bundle, verifies it against the community owner, joins, publishes your attributed Join, and updates your community list.

## Direct invites

A direct invite is a NIP-59 gift wrap addressed to a specific user. Concord uses them for two things:

- Inviting someone to a **new** community.
- Handing a member the key to a **private channel** (see [Channels](/concord/channels)).

The [client](/concord/client) watches the user's inbox for these automatically when `watchDirectInvites` is on (the default).

### The InviteWatcher

The watcher is exposed reactively so your UI can react once it exists:

```ts
client.directInviteWatcher$.subscribe((watcher) => {
  if (!watcher) return;
  watcher.pendingCount$.subscribe((n) => showBadge(n)); // pending invites for a badge
  watcher.invites$.subscribe((invites) => renderInbox(invites)); // decrypted, visible invites
});
```

By default invites arrive **locked** — the watcher won't invoke the user's signer without intent. `pending$` / `pendingCount$` surface how many are waiting; decrypt them when the user opens their invite inbox:

```ts
const invites = await watcher.readPending();
```

(Turn on `autoUnlock` on the client to decrypt invites as they arrive instead.)

### Acting on a direct invite

A direct invite for a community the user is **already in** — a private-channel key grant — is folded in automatically; the channel just starts syncing. Nothing for you to do.

A direct invite to a **new** community is left for your app to accept, so the user stays in control:

```ts
const community = await client.joinByBundle(invite.bundle);
```

### Managing the inbox

The watcher keeps local dismissal state so the user can tidy their inbox without deleting relay data:

```ts
await watcher.dismiss(invite);   // hide it
await watcher.restore(invite);   // bring it back
await watcher.clearDismissed();  // reset
```

Use `isDismissed(invite)` to check state, and `dismissed$` to observe the whole set.

### Authentication

Some inbox relays require NIP-42 auth to serve gift wraps. `needsAuth$` tells you when the user must authenticate; drive it explicitly (or set `autoAuthenticate` to let the watcher handle it):

```ts
watcher.needsAuth$.subscribe((needs) => {
  if (needs) promptToAuthenticate();
});

await watcher.authenticateUser();
```
