---
description: Concord (CORD) — end-to-end encrypted Nostr communities with channels, roles, and invites
---

# Concord

The `applesauce-concord` package is an implementation of the **Concord protocol (CORD)** — end-to-end encrypted, relay-agnostic communities on Nostr. Think Discord-style servers (channels, roles, invites, moderation) where every message is sealed and gift-wrapped so relays only ever see opaque blobs.

This section is a guide to **building an app** on top of the client engines in `applesauce-concord/client`. For the exact shape of every class, option, and type, see the [TypeDoc reference](https://applesauce.build/typedoc/modules/applesauce-concord.html).

:::warning
Concord is an evolving protocol. Treat the client API as stable enough to build on, but expect additions as more of the spec lands.
:::

## Installation

:::code-group

```sh [npm]
npm install applesauce-concord
```

```sh [yarn]
yarn install applesauce-concord
```

```sh [pnpm]
pnpm install applesauce-concord
```

:::

Concord builds on the rest of applesauce. You'll also want a [RelayPool](/loading/relays/pool) for connections and a [signer](/creating/signers/signers) for the logged-in user:

```sh
npm install applesauce-relay applesauce-signers
```

## Mental model

A few concepts carry through the whole API. You rarely touch the cryptography directly, but knowing the vocabulary makes the client engines read clearly.

### Community

A **community** is the top-level unit — the "server". Every community has an owner, a set of relays, metadata (name, icon, banner), channels, roles, and members. It is identified by a `community_id` and joined with **key material**: the secrets that let you derive the stream keys and decrypt its traffic.

### Planes

A community's events are split into **planes** — independent encrypted streams keyed separately:

- **Control** — the versioned "database": metadata, channels, roles, grants, banlist, invite registry.
- **Guestbook** — membership events: Joins, Leaves, Kicks.
- **Channels** — the actual messages, one stream per channel.

You never route events between planes yourself; the engine decodes each wrap and files it into the right store.

### Everything is a rumor in a store

Concord carries no chat-fold logic of its own. Decoded events land in a [RumorStore](/core/event-store) per plane, and you read them with the **standard applesauce store/model/timeline API** — the same tools you'd use for any Nostr events. Community *state* (channels, roles, members) is a folded model you consume as a reactive value.

### Epochs and rekeys

When someone is banned or removed, the community **refounds**: it rotates to a new **epoch** with fresh keys delivered only to the members who remain. Private channels rotate the same way with a **channel rekey**. The engines walk these epochs forward automatically — you just observe the current `epoch` and members.

### Invites

There are two ways in:

- **Invite links** — a shareable URL anyone can redeem to join (CORD-05).
- **Direct invites** — a gift-wrapped invite addressed to one user's inbox, used both to invite someone to a new community and to hand over a private-channel key.

## The client engines

Everything you build against lives in `applesauce-concord/client`:

| Class | What it is |
| --- | --- |
| [`ConcordClient`](/concord/client) | The per-user manager. One instance per logged-in user; owns every joined community. |
| [`ConcordCommunity`](/concord/community) | A single community's reactive engine — read state, send messages, run admin actions. |
| `ConcordInviteManager` | The client-owned invite-link manager exposed as `client.invites`. |
| `ConcordPrivateChannel` | A sub-engine for one private channel. Spawned automatically; you rarely construct it. |
| [`InviteWatcher`](/concord/invites) | Watches the user's inbox for [direct invites](/concord/invites). |

Start with [The client](/concord/client) to wire everything together, then move on to [Communities](/concord/community), [Channels](/concord/channels), [Moderation](/concord/moderation), and [Invites](/concord/invites).
