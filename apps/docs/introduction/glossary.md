---
description: Definitions of key Applesauce terminology including events, signers, models, loaders, and observables
---

# Glossary

## Event

A nostr event defined in [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md)

## Signer

A class that follows the [NIP-07](https://github.com/nostr-protocol/nips/blob/master/07.md) API

## Helper method

A function that takes an event and returns some computed value from it.

## Event store

A in-memory database of events that can be subscribed to. (see [Event Store](../core/event-store.md))

## Observable

A lazy stream of values that is active when subscribed to. (see [Observables](https://rxjs.dev/guide/observable))

## Model

Computed state from the event store that can be subscribed to. (see [Models](../core/models.md))

## Loader

A stateful function that loads events from relays or a cache. (see [Loaders](../loading/loaders/package.md))

## Encrypted content

The `content` field of an event that is encrypted using NIP-04 or NIP-44.

## Hidden content

The `content` field that is encrypted by the signer to its own pubkey. primary used in NIP-51 lists.

## Hidden tags

An array of event tags that is in the **hidden content**
