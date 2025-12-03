---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "AppleSauce"
  text: "Modular SDK for Nostr"
  tagline: Build reactive nostr UI with less code
  actions:
    - theme: brand
      text: Getting Started
      link: /introduction/getting-started
    - theme: alt
      text: Reference
      link: https://hzrd149.github.io/applesauce/typedoc/index.html
    - theme: alt
      text: Examples
      link: https://hzrd149.github.io/applesauce/examples/
    - theme: alt
      text: Migrations
      link: /migration/v1-v2

features:
  - title: Reactive
    details: AppleSauce is built using RxJS observables, which makes subscribing to events simple and reactive and avoids messy state management.
  - title: No Lock-in
    details: All the packages are designed to work with generic interfaces so its possible to use any other nostr libraries.
  - title: Modular
    details: All the packages support tree shaking so you can only include the parts you need.
---

## Core Packages

AppleSauce is built on top of [RxJS](https://rxjs.dev) and uses the observable pattern to provide a reactive, event-driven architecture for Nostr applications.

- **applesauce-core** - Essential utilities for working with Nostr events, keys, protocols, event storage, and the EventFactory for creating events
- **applesauce-relay** - Simple relay connection management with automatic reconnection
- **applesauce-signers** - Flexible signing interfaces supporting multiple providers
- **applesauce-loaders** - High-level data loaders for common Nostr patterns

## Quick Examples

### Subscribe to Events and updating the UI

The event store makes it easy to query and subscribe to events reactively:

```typescript
import { EventStore } from "applesauce-core/event-store";

// Create an event store
const store = new EventStore();

// Subscribe to a timeline of kind:1 events (notes)
store.timeline({ kinds: [1], limit: 10 }).subscribe((events) => {
  console.log(`Timeline updated: ${events.length} notes`);

  renderTimeline(events);
});

// Add events to the store - timeline updates automatically
store.add(event);
```

### Fetch Events from Relays

Connect to relays and fetch events with minimal code:

```typescript
import { RelayPool, onlyEvents } from "applesauce-relay";

// Create an event store to hold state (events)
const store = new EventStore();

// Create a relay connection
const pool = new RelayPool();

// Subscribe to events from the relay
pool
  .subscription(["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"], { kinds: [1], limit: 20 })
  .pipe(onlyEvents())
  .subscribe((event) => store.add(event));

// Subscribe to the timeline from the event store
store.timeline({ kinds: [1] }).subscribe((events) => {
  console.log(`Timeline updated: ${events.length} notes`);
});
```
