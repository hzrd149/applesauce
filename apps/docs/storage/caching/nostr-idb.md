---
description: IndexedDB-based event cache using nostr-idb for browser storage
---

# nostr-idb Package

The `nostr-idb` package provides a browser-based IndexedDB storage solution for Nostr events, allowing you to cache events locally in web applications built with Applesauce.

## Overview

`nostr-idb` is a lightweight IndexedDB wrapper specifically designed for storing and querying Nostr events in web browsers. The `NostrIDB` class provides a full relay-like API with automatic batching, in-memory index caching, and subscription management.

The package integrates seamlessly with Applesauce's event store system, providing persistent local caching that improves application performance and enables offline functionality.

:::info Complete API Documentation

For complete API documentation, see the [nostr-idb npm package](https://www.npmjs.com/package/nostr-idb).

:::

## Key Features

- **Browser-based Storage**: Uses IndexedDB for persistent storage in web browsers
- **In-Memory Index Caching**: Caches indexes in memory for dramatically faster repeated queries
- **Automatic Batching**: Automatically batches writes for optimal performance
- **Relay-like API**: Complete nostr relay-like interface with subscriptions
- **Automatic Pruning**: Can automatically prune old events to manage storage
- **Built for Performance**: Built directly on top of IndexedDB for the lowest latency

## Installation

:::code-group

```sh [npm]
npm install nostr-idb
```

```sh [yarn]
yarn install nostr-idb
```

```sh [pnpm]
pnpm install nostr-idb
```

:::

## Basic Usage

### Setting Up with Applesauce

The `NostrIDB` class integrates with Applesauce's event loaders through a cache request function:

```js
import { EventStore } from "applesauce-core";
import { persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { NostrIDB } from "nostr-idb";

// Create your event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

// Create a NostrIDB instance (creates its own database automatically)
// You can optionally pass configuration options:
const nostrIDB = new NostrIDB({
  cacheIndexes: 1000, // Cache 1000 indexes in memory for faster queries
  batchWrite: 1000, // Batch writes for better performance
  writeInterval: 100, // Write interval in ms
  maxEvents: 10000, // Maximum events to store
});

// Start the database (starts background processes)
await nostrIDB.start();

// Create a cache request function for event loaders
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
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});
```

### How It Works

1. **Database Initialization**: Create a `NostrIDB` instance (it will create its own IndexedDB database automatically) and call `start()` to begin background processes
2. **In-Memory Index Caching**: Indexes are cached in memory (configurable via constructor options) for dramatically faster repeated queries
3. **Automatic Batching**: Events are automatically batched for optimal write performance
4. **Cache Integration**: The `cacheRequest` function uses `nostrIDB.filters()` which returns a `Promise<NostrEvent[]>` - this queries the cache before event loaders query relays
5. **Event Persistence**: `persistEventsToCache()` automatically saves new events to the cache as they're added to the event store

## Integration Patterns

### With Event Loaders

The most common use case is integrating the cache with Applesauce's event loaders:

```js
import { EventStore } from "applesauce-core";
import { Filter } from "applesauce-core/helpers";
import { persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { NostrIDB } from "nostr-idb";

const eventStore = new EventStore();
const pool = new RelayPool();

// Initialize NostrIDB (creates its own database)
const nostrIDB = new NostrIDB();
await nostrIDB.start();

// Create cache request function
const cacheRequest = (filters: Filter[]) => nostrIDB.filters(filters);

// Persist events to cache
persistEventsToCache(eventStore, async (events) => {
  await Promise.allSettled(
    events.map(async (event) => {
      await nostrIDB.add(event);
    }),
  );
});

// Use cache with event loader
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: ["wss://relay.example.com"],
});
```

### With Timeline Loaders

You can also use the cache with timeline loaders:

```js
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { NostrIDB } from "nostr-idb";

const nostrIDB = new NostrIDB();
await nostrIDB.start();

const cacheRequest = (filters) => nostrIDB.filters(filters);

// Persist events to cache
persistEventsToCache(eventStore, async (events) => {
  await Promise.allSettled(
    events.map(async (event) => {
      await nostrIDB.add(event);
    }),
  );
});

// Create timeline loader with cache
const timeline = createTimelineLoader(
  pool,
  ["wss://relay.example.com"],
  { kinds: [1] },
  { eventStore, cache: cacheRequest },
);
```

## Performance Considerations

### In-Memory Index Caching

The most important performance feature for IndexedDB is **in-memory index caching**. The `cacheIndexes` option controls how many indexes are cached in memory:

```js
const nostrIDB = new NostrIDB({
  cacheIndexes: 1000, // Default: 1000 indexes cached in memory
});
```

**Why this matters:**

- IndexedDB queries can be slow when reading from disk
- Caching indexes in memory dramatically speeds up repeated queries
- Higher values use more memory but provide faster queries
- For applications with many repeated queries, increase `cacheIndexes`

### Other Performance Features

- **Automatic Batching**: Events are automatically batched (configurable via `batchWrite` and `writeInterval` constructor options) for optimal write performance
- **Deduplication**: `add()` automatically handles event deduplication
- **Indexed Queries**: IndexedDB indexes make filter queries efficient
- **Memory Usage**: Events are stored in IndexedDB, not in memory, reducing memory footprint
- **Automatic Pruning**: The `NostrIDB` class can automatically prune old events to stay within `maxEvents` limit
- **Count Method**: Use `nostrIDB.count(filters)` to get event counts matching filters (returns a Promise that can be used with RxJS observables)

## Limitations

- **Browser Only**: IndexedDB is only available in browser environments, not in Node.js
- **Storage Limits**: Subject to browser storage quotas (typically 50-100MB per origin)
- **No Full-Text Search**: Unlike SQLite implementations, `nostr-idb` doesn't provide full-text search capabilities
- **Lifecycle Management**: Requires calling `start()` before use and `stop()` when done to properly manage background processes
