---
description: Event database implementations for persistent storage with AsyncEventStore
---

# Event Databases

Event databases are persistent storage backends designed to work with the [`AsyncEventStore`](https://applesauce.build/typedoc/classes/applesauce-core.AsyncEventStore.html). They implement the [`IAsyncEventDatabase`](https://applesauce.build/typedoc/interfaces/applesauce-core.IAsyncEventDatabase.html) interface and are designed for backends and servers that need to store large amounts of events.

## Overview

Event databases serve as the primary persistence layer for the `AsyncEventStore`. Unlike event caches, which are designed for selective caching of frequently accessed events, event databases are designed to persist **all events** added to the store. This makes them ideal for:

- **Backend services** that need to maintain a complete event history
- **Relay implementations** that store events for other clients
- **Server applications** that process and store large volumes of events
- **Applications** that need to work with async database operations

## Key Characteristics

### Async Interface

Event databases implement the `IAsyncEventDatabase` interface, which means all operations are asynchronous:

```ts
import { AsyncEventStore } from "applesauce-core";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";

const database = new LibsqlEventDatabase("file:./events.db");
await database.initialize();

const eventStore = new AsyncEventStore({ database });

// All operations are async
await eventStore.add(event);
const event = await eventStore.getEvent(eventId);
const events = await eventStore.getByFilters({ kinds: [1] });
```

### Complete Persistence

Event databases persist all events added to the store, not just selected ones. When you add an event to an `AsyncEventStore` with a database backend, it's automatically persisted:

```ts
// All events are automatically persisted
await eventStore.add(profileEvent); // Persisted
await eventStore.add(noteEvent); // Persisted
await eventStore.add(reactionEvent); // Persisted
```

### Designed for Scale

Event databases are optimized for storing and querying large numbers of events:

- **Efficient indexing** for fast queries
- **Batch operations** for better performance
- **Full-text search** support (in some implementations)
- **Connection pooling** and async operations for scalability

## Available Implementations

Applesauce provides several event database implementations:

### SQLite-Based Databases

Event databases come in two flavors:

**Async Databases** (require `AsyncEventStore`):

- **[LibSQL](./libsql.md)** - Async SQLite with remote support
- **[Turso](./turso.md)** - Turso cloud database
- **[Turso WASM](./turso-wasm.md)** - Turso in the browser

**Sync Databases** (work with `EventStore`):

- **[Better SQLite3](./better-sqlite3.md)** - Synchronous SQLite for Node.js
- **[Native SQLite](./native.md)** - Native SQLite bindings
- **[Bun SQLite](./bun.md)** - Bun's built-in SQLite

> **Note**: While sync databases can work with the regular `EventStore`, this documentation focuses on async databases designed for `AsyncEventStore`. For sync database usage, see the individual implementation pages.

### Choosing an Implementation

| Implementation | Environment     | Interface | Remote Support | Best For                           |
| -------------- | --------------- | --------- | -------------- | ---------------------------------- |
| Better SQLite3 | Node.js         | Sync      | ❌             | Maximum performance, local storage |
| Native SQLite  | Node.js         | Sync      | ❌             | Native bindings, local storage     |
| Bun SQLite     | Bun             | Sync      | ❌             | Bun applications                   |
| LibSQL         | Node.js/Browser | Async     | ✅             | Remote databases, Turso            |
| Turso          | Node.js         | Async     | ✅             | Cloud-hosted databases             |
| Turso WASM     | Browser         | Async     | ✅             | Browser-based applications         |

## Basic Usage

### Creating an Event Database

```ts
import { AsyncEventStore } from "applesauce-core";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";

// Create the database
const database = new LibsqlEventDatabase("file:./events.db");

// Initialize (required for some implementations)
await database.initialize();

// Create the event store with the database
const eventStore = new AsyncEventStore({ database });
```

### Adding Events

Events are automatically persisted when added to the store:

```ts
// Events are automatically persisted to the database
await eventStore.add(event);
```

### Querying Events

All query operations are async:

```ts
// Get a single event
const event = await eventStore.getEvent(eventId);

// Check if an event exists
const exists = await eventStore.hasEvent(eventId);

// Query by filters
const events = await eventStore.getByFilters({
  kinds: [1],
  authors: ["pubkey..."],
});

// Get a timeline
const timeline = await eventStore.getTimeline({
  kinds: [1],
  limit: 100,
});
```

## Integration with AsyncEventStore

The `AsyncEventStore` automatically uses the database for all persistence operations:

```ts
import { AsyncEventStore } from "applesauce-core";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";
import { RelayPool } from "applesauce-relay";

// Setup
const database = new LibsqlEventDatabase("file:./events.db");
await database.initialize();
const eventStore = new AsyncEventStore({ database });
const pool = new RelayPool();

// Subscribe to relay and persist all events
const subscription = pool.subscription([{ kinds: [0, 1, 3] }]);
subscription.events$.subscribe(async (event) => {
  // Automatically persisted to database
  await eventStore.add(event, event.relay);
});

// Query persisted events
const profiles = await eventStore.getByFilters({ kinds: [0] });
console.log(`Stored ${profiles.length} profiles`);
```

## Advanced Features

### Full-Text Search

Some implementations support full-text search:

```ts
const database = new LibsqlEventDatabase("file:./events.db", {
  search: true,
});
await database.initialize();

const eventStore = new AsyncEventStore({ database });

// Search events
const results = await eventStore.getByFilters({
  search: "bitcoin lightning",
  kinds: [1],
});
```

### Custom Search Formatters

Customize how content is indexed:

```ts
const database = new LibsqlEventDatabase("file:./events.db", {
  search: true,
  searchContentFormatter: (event) => {
    // Extract searchable content
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});
```

### Rebuilding Search Indexes

Rebuild search indexes when needed:

```ts
await database.rebuildSearchIndex();
```
