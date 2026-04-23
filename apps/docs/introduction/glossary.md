---
description: Definitions of key Applesauce terminology including events, signers, models, loaders, casts, observables, factories, and operations
---

# Glossary

## Event

A Nostr event defined in [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md) — the base unit of data in Nostr. An event has a `kind`, `content`, `tags`, `created_at`, `pubkey`, `id`, and `sig`.

## Replaceable event

An event kind where a newer event from the same author overwrites the older one. Covers kinds `0`, `3`, and `10000`–`19999` as defined by [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md). Only the latest version is kept in the event store.

## Addressable event

An event kind `30000`–`39999` that is replaced by `pubkey + kind + d-tag` rather than just `pubkey + kind`. Also called a "parameterized replaceable event". An author can publish many addressable events of the same kind as long as each has a distinct `d` tag.

## Event pointer

A reference to a specific event — usually a `{ id, relays?, author? }` shape or an `nevent` NIP-19 string. See [NIP-19](https://github.com/nostr-protocol/nips/blob/master/19.md).

## Profile pointer

A reference to a user — usually a `{ pubkey, relays? }` shape or an `nprofile` NIP-19 string.

## Address pointer

A reference to an addressable event — a `{ kind, pubkey, identifier, relays? }` shape or an `naddr` NIP-19 string.

## Signer

A class that follows the [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) API — exposes `getPublicKey()`, `signEvent()`, and optionally `nip04`/`nip44` encryption methods. The `applesauce-signers` package provides implementations for browser extensions, private keys, NIP-46 bunkers, NIP-49 encrypted keys, and more.

## Helper method

A function that takes an event and returns some computed value from it. Helpers are pure, often memoized, and form the base layer most of the SDK is built on.

## Event store

An in-memory database of events that can be subscribed to. Handles deduplication, replaceable-event replacement, and exposes reactive observables for filters and individual events. See [Event Store](../core/event-store.md).

## Model

Computed state from the event store that can be subscribed to. A model is a function registered with `eventStore.model(...)` that turns one or more events into a reactive observable of derived data — a contact list, a profile, a timeline. See [Models](../core/models.md).

## Cast

A typed class produced by `castEvent` or `castUser` that wraps a raw event or pubkey with both synchronous properties and reactive observable properties. Casts are the primary way UI code consumes Nostr data in Applesauce. See [Casting System](../core/casting.md).

## Observable

A lazy stream of values that is active when subscribed to. See [RxJS Observables](https://rxjs.dev/guide/observable).

## Chainable observable

An observable that exposes property accessors returning more observables, so you can dot-chain into nested reactive data (e.g. `note.author.profile$.displayName`) without manually composing RxJS operators. All `$`-suffixed properties on cast classes are chainable observables.

## Factory

A chainable builder class for creating Nostr events. `EventFactory` and its subclasses (like `NoteFactory`) expose methods like `.content()`, `.as(signer)`, and `.sign()` that compose event operations into a signed event. See [Event Factory](../creating/factory/event-factory.md).

## Operation

A reusable transform function in the factory pipeline. An **event operation** takes a draft event and returns a new draft; a **tag operation** takes a tag array and returns a new tag array. Operations are composed with `eventPipe(...)` and applied via `.chain(...)` or `modifyPublicTags(...)`. See [Event Operations](../creating/factory/event-operations.md) and [Tag Operations](../creating/factory/tag-operations.md).

## Action

An async function that runs a "read–modify–publish" cycle against an event store, signer, and publish method. Actions are executed with `ActionRunner.run()` or `.exec()` and cover common flows like follow, mute, bookmark, and list management. See [Actions](../apps/actions/actions.md).

## Loader

A stateful function that loads events from relays or a cache. Loaders handle batching, relay-hint routing, and caching so a single pubkey request becomes one relay query per batch window. See [Loaders](../loading/loaders/package.md).

## Upstream pool

The adapter interface loaders use to talk to a relay library. An `UpstreamPool` is either a `(relays, filters) => Observable<Event>` function or an object with a `request` method matching that signature — which lets Applesauce loaders work on top of `applesauce-relay`, `nostr-tools`' `SimplePool`, NDK, or Nostrify. See [Upstream Pool](../loading/loaders/upstream-pool.md).

## NAST

Nostr Abstract Syntax Tree — the tree structure that `applesauce-content` parses a text note's `content` field into. Nodes represent text, mentions, hashtags, links, emojis, invoices, cashu tokens, galleries, and more. Renderers walk the tree to produce React, DOM, or plain-text output. See [Content](../apps/content/index.md).

## Encrypted content

The `content` field of an event that is encrypted using [NIP-04](https://github.com/nostr-protocol/nips/blob/master/04.md) or [NIP-44](https://github.com/nostr-protocol/nips/blob/master/44.md).

## Hidden content

The `content` field that is encrypted by the signer to its own pubkey. Primarily used in [NIP-51](https://github.com/nostr-protocol/nips/blob/master/51.md) lists to store private entries.

## Hidden tags

An array of event tags stored inside the **hidden content**. Decrypted, parsed, and exposed alongside the event's public tags.
