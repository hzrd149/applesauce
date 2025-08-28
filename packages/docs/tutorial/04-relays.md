# 4. Connecting to Relays

The `RelayPool` class is your gateway to the Nostr network. It manages connections to multiple relays and provides a reactive interface for subscribing to events and publishing. Let's learn how to connect to relays and feed real events into your EventStore.

## What is RelayPool?

RelayPool is a connection manager that:

- **Manages WebSocket connections** to multiple Nostr relays
- **Handles reconnection** automatically when connections drop
- **Provides subscription methods** that return RxJS observables
- **Deduplicates subscriptions** across multiple relays
- **Handles relay-specific logic** like authentication and rate limiting

## Creating a RelayPool

```typescript
import { RelayPool } from "applesauce-relay";

// Create a relay pool
const pool = new RelayPool();
```

> 💡 **Best Practice**: Create one RelayPool instance for your entire application, just like EventStore.

## Basic Relay Subscription

Here's how to subscribe to events from a single relay:

```typescript
import { RelayPool, onlyEvents } from "applesauce-relay";
import { EventStore, mapEventsToStore } from "applesauce-core";

const pool = new RelayPool();
const eventStore = new EventStore();

// Subscribe to text notes from a specific relay
pool
  .relay("wss://relay.damus.io")
  .subscription({ kinds: [1], limit: 20 })
  .pipe(
    // Filter out non-event messages (EOSE, NOTICE, etc.)
    onlyEvents(),
    // Add events to the EventStore (deduplicates automatically)
    mapEventsToStore(eventStore),
  )
  .subscribe((event) => {
    console.log("New event added to store:", event.id);
  });
```

## Multiple Relays

The relay pool also provides a `subscription` method that can take an array of relays and opens the same subscription on all relays.

```typescript
const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];

// Subscribe to all relays simultaneously
pool
  .subscription(relays, { kinds: [1], limit: 20 })
  .pipe(onlyEvents(), mapEventsToStore(eventStore))
  .subscribe((event) => {
    console.log(event);
  });
```

## Duplicate Event Handling

The relay pool will return all events from all relays. this means that you get some duplicate events. to solve this you can use the `mapEventsToStore` operator.

```typescript
const eventStore = new EventStore();
const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];

pool
  .subscription(relays, { kinds: [1], limit: 20 })
  .pipe(onlyEvents(), mapEventsToStore(eventStore))
  .subscribe((event) => {
    console.log(event);
    // Only logs unique events
  });
```

## Handling Relay Responses

RelayPool subscriptions will emit events and the `"EOSE"` message when the relay has sent all events. Use the `onlyEvents()` operator to ignore the `"EOSE"` message:

```typescript
pool
  .relay("wss://relay.damus.io")
  .subscription({ kinds: [1] })
  .subscribe((message) => {
    console.log(message);
    // Logs: [event1, event2, event3, "EOSE"]
  });

// vs with onlyEvents()

pool
  .relay("wss://relay.damus.io")
  .subscription({ kinds: [1] })
  .pipe(onlyEvents())
  .subscribe((event) => {
    console.log("Event only:", event);
    // Logs: [event1, event2, event3]
  });
```

## Error Handling

The returned observable will error if the relay connection fails. make sure to handle errors gracefully.

```typescript
pool
  .relay("wss://relay.damus.io")
  .subscription({ kinds: [1] })
  .pipe(onlyEvents())
  .subscribe({
    next: (event) => {
      // Handle successful event
      eventStore.add(event);
    },
    error: (error) => {
      console.error("Relay subscription error:", error);
      // Maybe try connecting to a different relay
    },
  });
```

## Key Concepts

- **RelayPool manages connections** to multiple Nostr relays
- **Use onlyEvents()** to filter subscription messages
- **mapEventsToStore()** automatically adds events to EventStore
- **Subscriptions are reactive** - they automatically update your UI
- **Handle errors gracefully** - relay connections can fail
- **Deduplicate across relays** - same event from multiple relays is only added once

## Common Patterns

### Auto-reconnecting Timeline

```typescript
function createAutoReconnectingSubscription(relayUrl: string) {
  return pool
    .relay(relayUrl)
    .subscription({ kinds: [1], limit: 100 })
    .pipe(
      onlyEvents(),
      mapEventsToStore(eventStore),
      // Retry on error
      retry({ count: 3, delay: 1000 }),
    );
}
```

## Example: React Timeline

Here's a complete react example using the RelayPool and EventStore to display a live timeline:

```tsx
import React, { useEffect } from "react";
import { RelayPool, onlyEvents } from "applesauce-relay";
import { EventStore, mapEventsToStore, mapEventsToTimeline } from "applesauce-core";
import { ProfileModel, TimelineModel } from "applesauce-core/models";
import { getDisplayName, getProfilePicture } from "applesauce-core/helpers";
import { useObservableMemo } from "applesauce-react/hooks";

// Create global instances
const eventStore = new EventStore();
const pool = new RelayPool();

function NoteCard({ note }: { note: any }) {
  const profile = useObservableMemo(() => eventStore.model(ProfileModel, note.pubkey), [note.pubkey]);

  const name = getDisplayName(profile, note.pubkey.slice(0, 8) + "...");
  const avatar = getProfilePicture(profile, `https://robohash.org/${note.pubkey}.png`);

  return (
    <div className="note-card">
      <div className="note-header">
        <img src={avatar} alt={name} className="avatar" />
        <strong>{name}</strong>
        <span>{new Date(note.created_at * 1000).toLocaleString()}</span>
      </div>
      <p>{note.content}</p>
    </div>
  );
}

function LiveFeed() {
  // This timeline will automatically update as new events arrive
  const timeline = useObservableMemo(() => eventStore.model(TimelineModel, { kinds: [1] }), []);

  return (
    <div className="feed">
      <h2>Latest Notes ({timeline?.length || 0})</h2>
      {timeline?.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}

function App() {
  useEffect(() => {
    // Start subscription when component mounts
    const subscription = pool
      .relay("wss://relay.damus.io")
      .subscription({ kinds: [1], limit: 50 })
      .pipe(
        // Filter out non-event messages (EOSE, NOTICE, etc.)
        onlyEvents(),
        // Add events to the EventStore and deduplicate them
        mapEventsToStore(eventStore),
      )
      .subscribe({
        next: (event) => console.log("Added event:", event.id),
        error: (err) => console.error("Relay error:", err),
        complete: () => console.log("Subscription complete"),
      });

    // Cleanup subscription on unmount
    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="app">
      <h1>Live Nostr Feed</h1>
      <LiveFeed />
    </div>
  );
}

export default App;
```
