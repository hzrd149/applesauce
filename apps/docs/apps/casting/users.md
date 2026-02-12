---
description: Cast pubkeys to User objects with reactive observable properties
---

# Casting Users

The `User` cast wraps a pubkey into an observable model with reactive access to profiles, contacts, mutes, bookmarks, relay lists, and more. It's the primary way to work with Nostr users in applesauce.

Import `castUser` from `applesauce-common/casts`:

```typescript
import { castUser, User } from "applesauce-common/casts";
```

## castUser()

Cast a pubkey (or profile pointer, or event) to a `User` instance. Users are cached globally, so casting the same pubkey twice returns the same instance.

```typescript
const user = castUser(pubkey, eventStore);
const user2 = castUser(profilePointer, eventStore);
const user3 = castUser(event, eventStore); // Uses event.pubkey
```

## User

The `User` class provides reactive access to all user-related data through observables.

[**User** — TypeDoc](https://applesauce.hzrd149.com/typedoc/classes/applesauce-common.Casts.User.html)

### Basic properties

```typescript
user.pubkey; // Hex pubkey string
user.npub; // NIP-19 encoded npub
user.nprofile; // NIP-19 encoded nprofile with relay hints
user.pointer; // ProfilePointer object with relay hints
```

### Profile

Get the user's profile metadata (kind 0).

```typescript
const profile = use$(user.profile$);

if (profile) {
  const displayName = profile.displayName;
  const name = profile.name;
  const about = profile.about;
  const picture = profile.picture;
  const banner = profile.banner;
  const website = profile.website;
  const nip05 = profile.dnsIdentity;
  const lud16 = profile.lud16;
  const lightningAddress = profile.lightningAddress; // lud16 or lud06
}
```

See [Profile cast](./events#profile) for more details.

### Contacts

Get the user's contact list (follows).

```typescript
const contacts = use$(user.contacts$);

// contacts is an array of User objects
contacts?.forEach((contact) => {
  const contactProfile = use$(contact.profile$);
  console.log(contactProfile?.displayName);
});
```

**Example:** [Contact Manager](https://applesauce.hzrd149.com/examples#contacts)

### Mutes

Get the user's mute list with public and hidden mutes.

```typescript
const mutes = use$(user.mutes$);

if (mutes) {
  // Public mutes
  const hashtags = mutes.hashtags; // Set<string>
  const words = mutes.words; // Set<string>
  const pubkeys = mutes.pubkeys; // Set<string>
  const threads = mutes.threads; // Set<string>

  // Check for hidden mutes
  const hasHidden = mutes.hasHidden;
  const unlocked = mutes.unlocked;

  // Unlock hidden mutes
  if (hasHidden && !unlocked) {
    await mutes.unlock(signer);
  }

  // Access hidden mutes (after unlocking)
  const hidden = use$(mutes.hidden$);
}
```

See [Mutes cast](./events#mutes) for more details.

**Example:** [Mutes Manager](https://applesauce.hzrd149.com/examples#mutes)

### Mailboxes (NIP-65)

Get the user's inbox and outbox relays.

```typescript
const mailboxes = use$(user.mailboxes$);
const outboxes = use$(user.outboxes$);
const inboxes = use$(user.inboxes$);

// Use outboxes for publishing
if (outboxes && outboxes.length > 0) {
  await pool.publish(outboxes, event);
}

// Use inboxes for fetching user's content
if (inboxes && inboxes.length > 0) {
  pool.subscription(inboxes, filter, { eventStore });
}
```

### Bookmarks

Get the user's bookmark list (kind 10003).

```typescript
const bookmarks = use$(user.bookmarks$);

if (bookmarks) {
  // Get resolved events
  const notes = use$(bookmarks.notes$);
  const articles = use$(bookmarks.articles$);

  // Check for hidden bookmarks
  if (bookmarks.hasHidden && !bookmarks.unlocked) {
    await bookmarks.unlock(signer);
  }

  // Access hidden bookmarks
  const hiddenNotes = use$(bookmarks.hiddenNotes$);
  const hiddenArticles = use$(bookmarks.hiddenArticles$);
}
```

See [BookmarksList cast](./events#bookmarkslist) for more details.

**Example:** [Bookmarks Manager](https://applesauce.hzrd149.com/examples#bookmarks)

### Relay Lists

Get the user's various relay lists.

```typescript
// Favorite relays (kind 10012)
const favoriteRelays = use$(user.favoriteRelays$);
const relays = favoriteRelays?.relays; // string[]

// Search relays (kind 10007)
const searchRelays = use$(user.searchRelays$);

// Blocked relays (kind 10006)
const blockedRelays = use$(user.blockedRelays$);

// DM relays (kind 10050)
const dmRelays = use$(user.directMessageRelays$);
```

All relay lists support hidden relays:

```typescript
if (favoriteRelays?.hasHidden && !favoriteRelays.unlocked) {
  await favoriteRelays.unlock(signer);
}

const hiddenRelays = use$(favoriteRelays.hidden$);
```

See [Relay Lists casts](./events#relay-lists) for more details.

### Groups

Get the user's NIP-29 group list.

```typescript
const groupsList = use$(user.groups$);

if (groupsList) {
  const groups = groupsList.groups; // GroupPointer[]

  // Unlock hidden groups if needed
  if (groupsList.hasHidden && !groupsList.unlocked) {
    await groupsList.unlock(signer);
  }

  const hiddenGroups = use$(groupsList.hidden$);
}
```

See [GroupsList cast](./events#groupslist) for more details.

### Live Stream

Get the user's current live stream (kind 30311).

```typescript
const stream = use$(user.live$);

if (stream) {
  const title = stream.title;
  const status = stream.status; // "live" | "ended" | "planned"
  const viewers = stream.viewers;
  const chatMessages = use$(stream.chat$);
}
```

See [Stream cast](./events#stream) for more details.

### Request Methods

Request replaceable or addressable events directly from the user.

```typescript
// Request a replaceable event (e.g., kind 30311 with identifier "my-stream")
const stream$ = user.replaceable(30311, "my-stream", relays);

// Request an addressable event (requires identifier)
const article$ = user.addressable(30023, "my-article", relays);
```

## User Cache

Users are cached globally by pubkey. This ensures that the same `User` instance is returned for the same pubkey, which is important for reactive subscriptions.

```typescript
const user1 = castUser(pubkey, eventStore);
const user2 = castUser(pubkey, eventStore);

console.log(user1 === user2); // true
```

To clear the cache (rarely needed):

```typescript
User.cache.clear();
```

## Usage with Actions

Combine users with the action system to modify user data:

```typescript
import { ActionRunner } from "applesauce-actions";
import { FollowUser, UnfollowUser, MuteUser } from "applesauce-actions/actions";

const actions = new ActionRunner(eventStore, factory);

// Follow a user
await actions.exec(FollowUser, contactPubkey).forEach(async (signed) => {
  await pool.publish(user.outboxes$, signed);
});

// Unfollow a user
await actions.exec(UnfollowUser, contactPubkey).forEach(async (signed) => {
  await pool.publish(user.outboxes$, signed);
});

// Mute a user
await actions.run(MuteUser, targetPubkey, false); // false = public mute
```

:::tip
All `$` suffixed properties on `User` return reactive observables that update when the underlying data changes. Use `use$` from `applesauce-react/hooks` to consume them in React components.
:::
