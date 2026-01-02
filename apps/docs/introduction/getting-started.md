# Getting Started

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

- **Browse the [examples](https://hzrd149.github.io/applesauce/examples)** to see whats possible
- **Check the [API documentation](https://hzrd149.github.io/applesauce/typedoc/)** for detailed reference
