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

- **applesauce-core** - Core protocol primitives and utilities
- **applesauce-common** - Helpers, models, and blueprints for common nostr application patterns
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
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { EventStore } from "applesauce-core";

// Create an event store to hold state (events)
const store = new EventStore();

// Create a relay connection
const pool = new RelayPool();

// Create an event store for the UI
const eventStore = new EventStore();

// Connect the event store to the relay pool
createEventLoaderForStore(eventStore, pool);

// Subscribe to events from the relay
pool
  .subscription(["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"], { kinds: [1], limit: 20 })
  .pipe(onlyEvents())
  .subscribe((event) => store.add(event));

// Subscribe to the timeline from the event store
store.timeline({ kinds: [1] }).subscribe((events) => {
  console.log(`Timeline updated: ${events.length} notes`);
});

// Subscribe and automatically load profiles from event store
const profile = eventStore
  .profile({
    pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
    relays: ["wss://relay.damus.io", "wss://nos.lol"],
  })
  .subscribe((profile) => {
    console.log("Profile:", profile);
  });
```

### React relay timeline

Casts make it incredibly easy to subscribe to user profiles and other metadata around events. Here's a complete React example:

```tsx
import { castEvent, Note } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { use$ } from "applesauce-react/hooks";
import { onlyEvents, RelayPool } from "applesauce-relay";
import { useState } from "react";

// Create an event store for storing events
const eventStore = new EventStore();
// And a relay pool for managing connections
const pool = new RelayPool();

// Connect the event store to the relay pool for automatic event loading
createEventLoaderForStore(eventStore, pool, {
  // Fallback relays to find profiles and NIP-65 events
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});

function ReplyingTo({ note }: { note: Note }) {
  // Subscribe to the profile of the note being replied to
  const profile = use$(note.author.profile$);

  return (
    <div className="reply-context">
      <p>Replying to {profile.displayName}</p>
      <p className="reply-content">{note.event.content}</p>
    </div>
  );
}

function NoteComponent({ note }: { note: Note }) {
  // Subscribe to the author's profile - automatically loads and updates reactively
  const profile = use$(note.author.profile$);
  // Subscribe to fetch the event this note is replying to
  const replyingTo = use$(note.replyingTo$);
  // Cast the replying-to event to a Note if it exists
  const replyingToNote = replyingTo ? castEvent(replyingTo, Note, note.store) : null;

  return (
    <div className="note">
      {replyingToNote && <ReplyingTo note={replyingToNote} />}
      <div className="note-header">
        <img className="avatar" src={profile?.picture ?? `https://robohash.org/${note.author.pubkey}.png`} />
        <h3 className="author-name">{profile.displayName}</h3>
      </div>
      <p className="note-content">{note.event.content}</p>
    </div>
  );
}

export default function Timeline() {
  const [relay, setRelay] = useState("wss://relay.damus.io/");

  // Subscribe to a timeline of notes from a relay
  // The castTimelineStream automatically transforms events into Note objects
  const notes = use$(
    () =>
      pool
        .relay(relay)
        .subscription({ kinds: [1] })
        .pipe(
          // Ignore EOSE messages
          onlyEvents(),
          // Add all events to the store
          mapEventsToStore(eventStore),
          // Sort events into an array
          mapEventsToTimeline(),
          // Cast events to Note objects
          castTimelineStream(Note),
        ),
    [relay],
  );

  return (
    <div className="timeline">
      {notes?.map((note) => (
        <NoteComponent key={note.id} note={note} />
      ))}
    </div>
  );
}
```
