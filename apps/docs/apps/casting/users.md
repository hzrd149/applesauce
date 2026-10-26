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

[**User** — TypeDoc](https://applesauce.build/typedoc/classes/applesauce-common.Casts.User.html)

### Basic properties

```typescript
user.pubkey; // Hex pubkey string
user.npub; // NIP-19 encoded npub
user.nprofile; // NIP-19 encoded nprofile with relay hints
user.pointer; // ProfilePointer object with relay hints
```

### Request Methods

Subscribe to replaceable or addressable events published by the user.

```typescript
// Replaceable event (e.g., the kind 10002 relay list)
const relayList$ = user.replaceable(10002);

// Addressable event (e.g., the kind 30311 live stream with identifier "my-stream")
const stream$ = user.addressable(30311, "my-stream", relays);
```

## Feature observables

`applesauce-common` adds feature observables to `User`. Each feature page covers the cast it returns and how to edit it.

| Observables                                                                                      | Feature                                                               |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `profile$`                                                                                       | [Profiles](/features/profiles)                                        |
| `contacts$`                                                                                      | [Follows](/features/follows)                                          |
| `mutes$`                                                                                         | [Mutes & Reports](/features/moderation)                               |
| `mailboxes$`, `outboxes$`, `inboxes$`                                                            | [Mailboxes & Outbox](/features/outbox)                                |
| `bookmarks$`                                                                                     | [Bookmarks](/features/bookmarks)                                      |
| `favoriteRelays$`, `searchRelays$`, `blockedRelays$`, `lookupRelayList$`, `directMessageRelays$` | [Relay Lists](/features/relay-lists)                                  |
| `groups$`                                                                                        | [Groups](/features/groups)                                            |
| `blossomServers$`                                                                                | [Blossom Servers](/features/blossom-servers)                          |
| `gitRepositories$`, `gitAuthors$`, `favoriteGitRepos$`, `graspServers$`                          | [Git](/features/git)                                                  |
| `nsites$`, `nsite$`, `nsiteSnapshots$`, `napplets$`, `napplet$`                                  | [Nostr Sites](/features/nostr-sites), [Napplets](/napplets/manifests) |
| `appHandlers$`, `appRecommendations$`                                                            | [App Handlers](/features/app-handlers)                                |

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

:::tip
All `$` suffixed properties on `User` return reactive observables that update when the underlying data changes. Use `use$` from `applesauce-react/hooks` to consume them in React components.
:::
