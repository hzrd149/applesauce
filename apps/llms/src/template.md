# Applesauce Nostr SDK — AI Agent Reference

_Generated {{generatedAt}}_

Website: [applesauce.build](https://applesauce.build)

Applesauce is a modular, reactive Nostr SDK built on RxJS. It covers event storage, relay communication, event creation/signing, content rendering, accounts, and React integration. All reactive APIs use RxJS Observables (suffix `$`).

---

## Quick Architecture

```
EventStore (in-memory, reactive)     ← central hub for all events
  ↕                                    deduplicates, handles replaceable/addressable
RelayPool / Relay (network)          ← WebSocket relay connections
  ↕
Loaders (batching + dedup)           ← auto-load events by id/address/timeline
  ↕
Factories + Operations               ← create/modify unsigned events
  ↕
Signers                              ← sign events (extension, NIP-46, password, etc.)
  ↕
ActionRunner                         ← orchestrate: build → sign → publish → store
  ↕
React hooks (use$, useRenderedContent, useEventModel)
```

---

## Packages

### applesauce-core
Central package. Provides `EventStore`, `EventFactory`, helpers, models, casts, RxJS operators.

**Key exports by subpath:**
- `applesauce-core` — `EventStore`, `EventFactory`, logger
- `applesauce-core/event-store` — `EventStore`, `AsyncEventStore`, `EventMemory`
- `applesauce-core/helpers` — event/tag/filter/profile/relay utility functions
- `applesauce-core/models` — `ProfileModel`, `ContactsModel`, `MailboxesModel`
- `applesauce-core/factories` — `EventFactory`, `ProfileFactory`, `DeleteFactory`
- `applesauce-core/operations` — `EventOperation`, `TagOperation`, `eventPipe`, `tagPipe`
- `applesauce-core/casts` — `Cast` base class, core cast types
- `applesauce-core/observable` — `mapEventsToStore`, `mapEventsToTimeline`, `watchEventUpdates`

### applesauce-common
NIP-specific helpers, factories, casts, and operations for most event kinds.

**Key exports by subpath:**
- `applesauce-common/helpers` — NIP-specific helpers (badges, zaps, groups, bookmarks, calendar, gift-wrap, etc.)
- `applesauce-common/factories` — `NoteFactory`, `CommentFactory`, `ReactionFactory`, `ZapRequestFactory`, `BadgeFactory`, `ProfileBadgesFactory`, list/relay factories
- `applesauce-common/operations` — per-NIP operations (`Note`, `Zap`, `Badge`, `BadgeAward`, `ProfileBadges`, `GiftWrap`)
- `applesauce-common/casts` — `Note`, `Article`, `Profile`, `User`, `Reaction`, `Zap`, `Badge`, `BadgeAward`, relay/list casts
- `applesauce-common/models` — domain-specific models

### applesauce-relay
Relay connections and pooling.

- `applesauce-relay` — `RelayPool`, `Relay`, `RelayGroup`, `RelayLiveness`
- `applesauce-relay/pool` — `RelayPool`
- `applesauce-relay/relay` — `Relay`
- `applesauce-relay/operators` — `onlyEvents`, `markFromRelay`, `completeOnEose`, `storeEvents`
- `applesauce-relay/negentropy` — NIP-77 sync

### applesauce-loaders
Batched, deduplicated event loading.

- `applesauce-loaders` — `UpstreamPool`, `CacheRequest`, `NostrRequest`
- `applesauce-loaders/loaders` — `UnifiedEventLoader` (`createEventLoaderForStore`), `EventLoader`, `AddressLoader`, `TimelineLoader`, `ReactionsLoader`, `ZapsLoader`, `TagValueLoader`
- `applesauce-loaders/operators` — `distinctRelays`, `distinctTimeout`

### applesauce-signers
Event signing implementations.

- `applesauce-signers/signers` — `ExtensionSigner` (NIP-07), `PrivateKeySigner`, `PasswordSigner` (NIP-49), `NostrConnectSigner` (NIP-46 client), `NostrConnectProvider` (NIP-46 server), `SerialPortSigner`, `SimpleSigner`, `ReadonlySigner`

### applesauce-actions
High-level actions that orchestrate factory → sign → publish.

- `applesauce-actions` — `ActionRunner`
- `applesauce-actions/actions` — `CreateProfile`, `UpdateProfile`, `FollowUser`, `UnfollowUser`, `MuteUser`, `UnmuteUser`, `BookmarkEvent`, `UnbookmarkEvent`, `CreateComment`, plus calendar, blossom, list, relay, and app-data actions

### applesauce-accounts
Multi-account management.

- `applesauce-accounts` — `AccountManager`, `ProxySigner`
- `applesauce-accounts/accounts` — `ExtensionAccount`, `PasswordAccount`, `PrivateKeyAccount`, `NostrConnectAccount`, `ReadonlyAccount`, `SerialPortAccount`, `SimpleAccount`

### applesauce-react
React bindings.

- `applesauce-react/hooks` — `use$`, `useEventModel`, `useObservable`, `useObservableMemo`, `useRenderedContent`, `useRenderNast`, `useAccountManager`, `useActiveAccount`, `useAccounts`, `useActionRunner`, `useAction`, `useEventStore`
- `applesauce-react/providers` — `EventStoreProvider`, `AccountsProvider`, `ActionsProvider`

### applesauce-content
Parse and render note/article content.

- `applesauce-content/text` — `getParsedContent`, transformers: `links`, `nostrMentions`, `galleries`, `emojis`, `hashtags`, `lightningInvoices`, `cashuTokens`
- `applesauce-content/nast` — NAST tree types, `truncate`, `findAndReplace`
- `applesauce-content/markdown` — `remarkNostrMentions`

### applesauce-sqlite
SQLite-backed event databases for persistent storage.

- `applesauce-sqlite/better-sqlite3` — `BetterSqlite3EventDatabase` (sync, Node.js)
- `applesauce-sqlite/libsql` — `LibsqlEventDatabase` (async)
- `applesauce-sqlite/turso` — `TursoEventDatabase`
- `applesauce-sqlite/turso-wasm` — `TursoWasmEventDatabase` (browser)
- `applesauce-sqlite/native` — `NativeSqliteEventDatabase`
- `applesauce-sqlite/bun` — `BunSqliteEventDatabase`

### applesauce-wallet
NIP-60 Cashu wallet (WIP).

- `applesauce-wallet/casts` — `Wallet`, `WalletToken`, `WalletHistory`, `Nutzap`
- `applesauce-wallet/models` — `WalletBalanceModel`, `WalletTokensModel`
- `applesauce-wallet/actions` — `CreateWallet`, `UnlockWallet`, `ReceiveToken`, `ReceiveNutzaps`

### applesauce-wallet-connect
NIP-47 Nostr Wallet Connect.

- `applesauce-wallet-connect/wallet-connect` — `WalletConnect` (client)
- `applesauce-wallet-connect/wallet-service` — `WalletService` (server)

---

## Core Concepts

### EventStore
Single source of truth for events. Handles dedup, replaceable events (NIP-33), addressable events, and deletions. All reads return Observables that update when data changes.

**Key methods:**
- `add(event)` — add event, returns the event or undefined if rejected
- `event(id)` — Observable of event by id
- `replaceable(kind, pubkey)` — Observable of latest replaceable event
- `addressable(pointer)` — Observable of addressable event (takes `AddressPointer` with `kind`, `pubkey`, `identifier`)
- `timeline(filters)` — Observable of sorted event arrays
- `filters(filters)` — Observable of events matching filters
- `model(ModelClass, ...args)` — get/create a reactive model instance
- `profile(pubkey)` — shortcut model for profile data
- `contacts(pubkey)` — shortcut model for contact list
- `getEvent(id)` — sync get (returns event or undefined)

### Reactive Pattern (RxJS)
All store queries, casts, and loaders return RxJS Observables. In React, use `use$` to subscribe:

```tsx
const profile = use$(store.profile(pubkey));
const notes = use$(() => castTimelineStream(store.timeline(filters), Note), [filters]);
```

### Casts
Type-safe wrappers around raw nostr events. Created via `castEvent(store, event, CastClass)` or `castEventStream` / `castTimelineStream` for collections. Each cast exposes typed properties and `$` observables for related data.

Common casts: `Note`, `Article`, `Profile`, `User`, `Reaction`, `Zap`, `Badge`, `BadgeAward`.

### Models
Reactive computed views from the store. Created via `store.model(ModelClass, ...args)`. Cached by arguments. Return Observables.

Built-in: `ProfileModel`, `ContactsModel`, `MailboxesModel`, `ReactionsModel`, `CommentsModel`.

### EventFactory + Operations
Typed factories (e.g. `NoteFactory`) extend `EventFactory` and provide static `.create()` / `.modify()` entry points. Chain `.as(signer)` then `.sign()` to produce a signed event:

```ts
const signed = await NoteFactory.create("Hello world").as(signer).sign();
```

`EventOperation` and `TagOperation` are composable functions for modifying event drafts. Use `modifyPublicTags(tagPipe(...ops))` to chain tag mutations.

### Loaders
Factory functions that batch requests and deduplicate via the store. `createEventLoaderForStore` wires a unified loader into the store so that `store.event()`, `store.replaceable()`, and `store.addressable()` automatically trigger network requests.

```ts
createEventLoaderForStore(store, pool, { lookupRelays: ["wss://purplepag.es"] });
// Now store queries auto-load from relays:
store.event({ id }).subscribe(event => console.log(event));
```

### Actions
Async functions receiving `ActionContext` with `events` (EventStore), `self` (user pubkey), `signer`, `publish`, and `run` (nest actions). `ActionRunner` orchestrates execution.

```ts
const runner = new ActionRunner(store, signer, pool);
await runner.run(FollowUser, targetPubkey);
```

### RelayPool
Manages relay connections. Supports subscriptions, publishing, outbox model (NIP-65), NIP-42 auth, and negentropy sync.

```ts
const pool = new RelayPool();
pool.subscription(filters, ["wss://relay.example.com"]).pipe(onlyEvents()).subscribe(e => store.add(e));
```

### Signers
All implement the NIP-07 signer interface (`signEvent`, `nip04`, `nip44`). Use `ExtensionSigner` for browser extensions, `NostrConnectSigner` for NIP-46 remote signing, `PasswordSigner` for NIP-49 encrypted keys.

### AccountManager
Manages multiple accounts with serialization. Integrates with `EventFactory` via `ProxySigner` so switching accounts automatically changes the signer.

### Caching / Storage
Two patterns:
1. **Client cache**: `EventStore` + `persistEventsToCache` (from `applesauce-core/helpers`) + `cacheRequest` on loaders. Uses `NostrIDB` (IndexedDB) or `window.nostrdb`.
2. **Full database**: `AsyncEventStore` + SQL backend (`LibsqlEventDatabase`, `TursoWasmEventDatabase`, etc.) for server-side or heavy clients.

---

## Common Patterns

### Minimal app setup
```ts
import { EventStore } from "applesauce-core";
import { RelayPool } from "applesauce-relay";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";

const store = new EventStore();
const pool = new RelayPool();
createEventLoaderForStore(store, pool);
```

### React integration
```tsx
import { EventStoreProvider } from "applesauce-react/providers";
import { use$ } from "applesauce-react/hooks";

// Wrap app in <EventStoreProvider eventStore={store}>
const profile = use$(store.profile(pubkey));
```

### Creating and publishing events
```ts
import { NoteFactory } from "applesauce-common/factories";

const signed = await NoteFactory.create("Hello world").as(signer).sign();
await pool.publish(signed, relays);
store.add(signed);
```

### Using actions
```ts
import { ActionRunner } from "applesauce-actions";
import { FollowUser } from "applesauce-actions/actions";

const runner = new ActionRunner(store, signer, pool);
await runner.run(FollowUser, targetPubkey);
```

---

## How To Use Examples

Examples are complete, single-file React applications demonstrating real Applesauce usage. Each file is self-contained with all imports, state management, and UI.

### Reading examples

Each example is listed below with a link to its rendered markdown file. The markdown contains the full source code. To understand how to implement a feature:

1. Find the example closest to your task from the list below
2. Read the full example file — it contains working, production-quality code
3. Note the imports — they show exactly which packages and subpaths to use
4. Note the patterns — how `EventStore`, `RelayPool`, loaders, casts, and `use$` are wired together

### Example structure

Every example follows this pattern:
- **JSDoc header**: description, tags, and related examples
- **Imports**: all applesauce packages plus React, RxJS, and UI dependencies
- **Shared services**: `EventStore`, `RelayPool`, loaders instantiated at module level
- **React component**: default export using `use$` for reactive data, actions for mutations
- **UI**: DaisyUI + Tailwind CSS components

### Key examples by topic

**Getting started**: `feed/relay-timeline` (basic feed), `simple/profile-editor` (profile editing), `casting/contacts` (follow/unfollow)

**Casts & reactive data**: `casting/thread` (Note cast + threading), `casting/custom` (custom EventCast subclass), `casting/mutes` (mute lists)

**Loaders**: `loader/paginated-timeline` (TimelineLoader), `loader/parallel-async-loading` (batch loading), `loader/using-ndk` / `loader/using-nostrify` / `loader/using-nostr-tools` (third-party pool adapters)

**Actions**: `simple/profile-editor` (UpdateProfile), `bookmarks/manager` (BookmarkEvent), `blossom/server-manager` (Blossom actions)

**Signers & accounts**: `signers/accounts` (AccountManager), `signers/password` (PasswordSigner), `signers/bunker` (NostrConnectSigner)

**Content rendering**: `content/simple-text` (useRenderedContent + ComponentMap), `content/articles` (markdown + comments)

**Caching**: `cache/nostr-idb` (IndexedDB), `cache/window.nostrdb` (nostrdb polyfill), `cache/worker-relay` (worker SQLite)

**Badges (NIP-58)**: `badges/profile` (view badges), `badges/editor` (edit profile badge pins)

**Wallet & payments**: `zap/zap-modal` (zap flow), `nwc/simple-wallet` (NWC pay), `wallet/wallet` (full Cashu wallet)

**Negentropy sync**: `negentrapy/relay-difference` (cross-relay diff), `negentrapy/note-reactions` (sync reactions)

**Outbox model**: `outbox/social-feed` (mailbox-aware feed), `outbox/relay-selection` (relay picking)

---

## Docs

{{docsIndex}}

## Examples

Examples are single-file React apps. Read the ones relevant to your current task for complete, working implementations.

{{examplesIndex}}
