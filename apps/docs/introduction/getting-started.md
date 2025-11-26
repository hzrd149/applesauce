# Getting Started

Ready to build reactive Nostr applications with applesauce? Follow our step-by-step tutorial that will teach you everything you need to know.

## 📚 [Complete Tutorial](../tutorial/00-introduction)

Our beginner-friendly tutorial covers:

1. **[Event Store](../tutorial/01-event-store.md)** - The reactive database at the heart of applesauce
2. **[Helpers](../tutorial/02-helpers.md)** - Extract and parse data from Nostr events
3. **[Models](../tutorial/03-models.md)** - Build reactive UI components
4. **[Relay Pool](../tutorial/04-relays.md)** - Connect to Nostr relays and receive events
5. **[Loaders](../tutorial/05-loaders.md)** - Load specific events on-demand
6. **[Event Factory](../tutorial/06-event-factory.md)** - Create and sign events
7. **[Publishing](../tutorial/07-publishing.md)** - Publish events to relays
8. **[Actions](../tutorial/08-actions.md)** - Run complex actions like following users

Each section includes complete code examples and builds toward a working social media application.

## Quick Overview

Applesauce consists of several key components that work together:

### EventStore

A reactive in-memory database that stores Nostr events and notifies your UI when data changes.

```ts
import { EventStore } from "applesauce-core";

const eventStore = new EventStore();

// Subscribe to timeline updates
eventStore.timeline({ kinds: [1] }).subscribe((notes) => {
  console.log(`Timeline updated with ${notes.length} notes`);
});
```

### Helpers

Utility functions that extract useful data from raw Nostr events.

```ts
import { getProfileContent, getDisplayName } from "applesauce-core/helpers";

const profile = getProfileContent(profileEvent);
const name = getDisplayName(profile);
```

### Models

Pre-built subscriptions that combine EventStore with helpers for reactive UI components.

```ts
import { ProfileModel } from "applesauce-core/models";

// Automatically parses and updates when profile changes
eventStore.model(ProfileModel, pubkey).subscribe((profile) => {
  console.log("Profile updated:", profile);
});
```

### RelayPool

Manages connections to Nostr relays and provides reactive subscriptions.

```ts
import { RelayPool, onlyEvents } from "applesauce-relay";

const pool = new RelayPool();

pool
  .relay("wss://relay.damus.io")
  .subscription({ kinds: [1] })
  .pipe(onlyEvents())
  .subscribe((event) => {
    eventStore.add(event);
  });
```

### EventFactory

Creates and signs Nostr events using pre-built blueprints.

```ts
import { EventFactory } from "applesauce-core";
import { NoteBlueprint } from "applesauce-common/blueprints";

const factory = new EventFactory({ signer });

const note = await factory.create(NoteBlueprint, "Hello Nostr!");
const signed = await factory.sign(note);
```

## Next Steps

- **Start with the [tutorial](../tutorial/00-introduction.md)** to learn step-by-step
- **Browse the [examples](https://hzrd149.github.io/applesauce/examples)** to see whats possible
- **Check the [API documentation](https://hzrd149.github.io/applesauce/typedoc/)** for detailed reference
