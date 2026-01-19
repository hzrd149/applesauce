# Event Caching

Event caching is designed to work alongside the synchronous [`EventStore`](https://applesauce.build/typedoc/classes/applesauce-core.EventStore.html). It's generally implemented using the [`persistEventsToCache`](https://applesauce.build/typedoc/functions/applesauce-core.Helpers.persistEventsToCache.html) helper method and a `cacheRequest` function that plugs into event loaders.

## Overview

Event caching is designed to work alongside the synchronous `EventStore` so that web applications can take advantage of the in-memory nature of the sync event store. The event store provides fast, synchronous access to events in memory, while the cache provides persistent storage for frequently accessed events like profiles, contacts, and other replaceable events. Unlike event databases, which persist all events, event caching allows you to selectively cache only the events you need.

## Key Characteristics

### In-Memory Event Store

Event caching works with the synchronous `EventStore`, which keeps all events in memory for fast, synchronous access. This makes it ideal for web applications where you want instant access to events without async operations:

```ts
import { EventStore } from "applesauce-core";
import { persistEventsToCache } from "applesauce-core/helpers";

const eventStore = new EventStore();

// All operations are synchronous and in-memory
eventStore.add(event); // Fast, synchronous, in-memory
const event = eventStore.getEvent(eventId); // Instant access
const events = eventStore.getByFilters({ kinds: [1] }); // No async overhead
```

### Selective Caching

Event caching allows you to cache only the events you need, typically:

- **Profiles** (kind 0) - User metadata
- **Contacts** (kind 3) - User contact lists
- **Replaceable events** - Frequently accessed replaceable events
- **Specific event IDs** - Events you want to cache for offline access

### Two-Part System

Event caching consists of two main components that work together without blocking the event store:

1. **`persistEventsToCache`** - Non-blocking: automatically saves new events to the cache **after** they are added to the store
2. **`cacheRequest`** - Loads events from the cache when requested by event loaders, so cache operations don't block the event store

## Basic Usage

### Setting Up Event Caching

```ts
import { EventStore } from "applesauce-core";
import { persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { NostrIDB } from "nostr-idb";

// Create your event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

// Create a cache (e.g., using nostr-idb)
const nostrIDB = new NostrIDB();
await nostrIDB.start();

// Create a cache request function
const cacheRequest = (filters) => nostrIDB.filters(filters);

// Automatically persist new events to the cache
persistEventsToCache(eventStore, async (events) => {
  await Promise.allSettled(
    events.map(async (event) => {
      await nostrIDB.add(event);
    }),
  );
});

// Use the cache with event loaders
const eventLoader = createEventLoader(pool, {
  cacheRequest,
  eventStore,
});
```

### How It Works

Event caching operates in a non-blocking manner to preserve the fast, synchronous nature of the in-memory event store:

1. **Event Loader Checks Cache First**: When an event loader needs to load an event, it first checks the cache using `cacheRequest`. This happens outside the event store, so it doesn't block synchronous operations.
2. **Cache Miss Falls Back to Relays**: If the event isn't in the cache, the loader fetches it from relays and adds it to the event store.
3. **New Events Are Cached Asynchronously**: When new events are added to the event store, they're immediately available in memory. `persistEventsToCache` then saves them to the cache **after** they're added (non-blocking), so the event store remains fast and synchronous.

```ts
// Event loader automatically uses cache
const eventLoader = createEventLoader(pool, {
  cacheRequest,
  eventStore,
});

// Load an event - checks cache first (non-blocking), then relays
eventLoader({ id: "event-id" }).subscribe((event) => {
  // Event is immediately available in the event store
  const cached = eventStore.getEvent("event-id"); // Fast, synchronous access

  if (isFromCache(event)) {
    console.log("Loaded from cache!");
  } else {
    console.log("Loaded from relay");
    // Event is now in the event store and will be cached asynchronously
  }
});
```

## Integration with Event Loaders

Event caching integrates seamlessly with Applesauce's event loaders. The key is that cache operations happen through event loaders, not directly through the event store, so they don't block the synchronous event store:

```ts
import { EventStore } from "applesauce-core";
import { persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { NostrIDB } from "nostr-idb";

const eventStore = new EventStore();
const pool = new RelayPool();
const nostrIDB = new NostrIDB();
await nostrIDB.start();

// Setup caching - cacheRequest is used by event loaders, not the event store
const cacheRequest = (filters) => nostrIDB.filters(filters);

// Persist events to cache after they're added to the store (non-blocking)
persistEventsToCache(eventStore, async (events) => {
  // This runs asynchronously after events are added to the store
  await Promise.allSettled(
    events.map(async (event) => {
      await nostrIDB.add(event);
    }),
  );
});

// Create event loader with cache - cache loading happens here, not in event store
const eventLoader = createEventLoader(pool, {
  cacheRequest, // Event loaders use this to check cache first
  eventStore,
  lookupRelays: ["wss://relay.example.com"],
});

// Use the loader - cache is checked by the loader, not the event store
eventLoader({ id: "profile-id" }).subscribe((event) => {
  // Event is immediately available in the event store (synchronous, in-memory)
  eventStore.add(event);
  // Cache persistence happens asynchronously in the background
});
```

## Available Cache Implementations

### nostr-idb (IndexedDB)

The most common cache implementation for web applications:

```ts
import { NostrIDB } from "nostr-idb";

const nostrIDB = new NostrIDB({
  cacheIndexes: 1000, // Cache 1000 indexes in memory
  maxEvents: 10000, // Maximum events to store
});

await nostrIDB.start();

const cacheRequest = (filters) => nostrIDB.filters(filters);
```

See the [nostr-idb documentation](./nostr-idb.md) for more details.

### Custom Cache Implementation

You can create a custom cache by implementing a `cacheRequest` function:

```ts
// Custom cache using localStorage (simple example)
function cacheRequest(filters: Filter[]): Promise<NostrEvent[]> {
  // Load events from your custom storage
  const cached = localStorage.getItem("nostr-cache");
  const events: NostrEvent[] = cached ? JSON.parse(cached) : [];

  // Filter events based on the provided filters
  return Promise.resolve(
    events.filter((event) => {
      // Implement filter matching logic
      return matchesFilters(event, filters);
    }),
  );
}

// Use with event loader
const eventLoader = createEventLoader(pool, {
  cacheRequest,
  eventStore,
});
```

## Advanced Usage

### Configuring Batch Persistence

Control how events are batched when persisting to cache:

```ts
const stopPersisting = persistEventsToCache(
  eventStore,
  async (events) => {
    await nostrIDB.addEvents(events);
  },
  {
    batchTime: 5000, // Wait 5 seconds before writing
    maxBatchSize: 100, // Maximum events per batch
  },
);

// Stop persisting when done
stopPersisting();
```

### Filtering Cached Events

Only cache specific event types:

```ts
persistEventsToCache(eventStore, async (events) => {
  // Only cache profiles and contacts
  const toCache = events.filter((e) => e.kind === 0 || e.kind === 3);

  if (toCache.length > 0) {
    await nostrIDB.addEvents(toCache);
  }
});
```

## Best Practices

### Cache Frequently Accessed Events

Focus on caching events that are accessed frequently:

```ts
// Cache profiles, contacts, and other replaceable events
persistEventsToCache(eventStore, async (events) => {
  const important = events.filter((e) => {
    return (
      e.kind === 0 || // Profiles
      e.kind === 3 || // Contacts
      isReplaceable(e.kind) // Other replaceable events
    );
  });

  if (important.length > 0) {
    await nostrIDB.addEvents(important);
  }
});
```
