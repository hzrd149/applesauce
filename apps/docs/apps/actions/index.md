---
description: Pre-built actions for common Nostr operations like following users, muting, bookmarking, and managing lists
---

# Actions

The `applesauce-actions` package provides pre-built, typed actions for the common things a Nostr app needs to do — follow and unfollow users, bookmark posts, mute accounts, update mailboxes, manage lists, send DMs, and more.

Actions encapsulate the full "read-modify-publish" cycle: they load the current state of a replaceable event from the `EventStore`, apply a change through a typed factory, and publish the result.

## Features

- **`ActionRunner`** — runs actions against an event store, signer, and publish method
- A large set of built-in actions covering contacts, mutes, bookmarks, pins, profile, mailboxes, relay sets, DM relays, favorites, follow sets, direct and wrapped messages, Blossom, calendar, comments, and app data
- Automatic "create-or-modify" semantics for replaceable events
- Works with any publishing method — `RelayPool`, a plain function, or anything with a `.publish()` method
- Actions are small async functions, so writing your own is easy

## Installation

:::code-group

```sh [npm]
npm install applesauce-actions
```

```sh [yarn]
yarn install applesauce-actions
```

```sh [pnpm]
pnpm install applesauce-actions
```

:::
