# Event Database

The Event Database is the core persistence layer of AppleSauce that enables automatic storage and retrieval of Nostr events. The `EventStore` can use an event database to persist events between application sessions, while maintaining the same API regardless of the underlying storage mechanism.

## Overview

The Event Database system provides a clean abstraction layer that allows the `EventStore` to work with any storage backend while maintaining consistent behavior. When no database is provided, the `EventStore` automatically falls back to using only the in-memory `EventMemory` for storage.

## Architecture

The EventStore acts as a smart wrapper around the event database, providing high-level features while the database handles the core storage operations. When no database is provided, the EventStore uses only EventMemory for storage.

## Database Interface

The event database system is built around two core interfaces:

### `IEventDatabase` (Synchronous)

```ts
interface IEventDatabase {
  // Read operations
  hasEvent(id: string): boolean;
  getEvent(id: string): NostrEvent | undefined;
  hasReplaceable(kind: number, pubkey: string, identifier?: string): boolean;
  getReplaceable(kind: number, pubkey: string, identifier?: string): NostrEvent | undefined;
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): NostrEvent[] | undefined;
  getByFilters(filters: Filter | Filter[]): NostrEvent[];
  getTimeline(filters: Filter | Filter[]): NostrEvent[];

  // Write operations
  add(event: NostrEvent): NostrEvent;
  remove(event: string | NostrEvent): boolean;
  update?(event: NostrEvent): void;
}
```

### `IAsyncEventDatabase` (Asynchronous)

```ts
interface IAsyncEventDatabase {
  // Read operations (all return Promises)
  hasEvent(id: string): Promise<boolean>;
  getEvent(id: string): Promise<NostrEvent | undefined>;
  hasReplaceable(kind: number, pubkey: string, identifier?: string): Promise<boolean>;
  getReplaceable(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent | undefined>;
  getReplaceableHistory(kind: number, pubkey: string, identifier?: string): Promise<NostrEvent[] | undefined>;
  getByFilters(filters: Filter | Filter[]): Promise<NostrEvent[]>;
  getTimeline(filters: Filter | Filter[]): Promise<NostrEvent[]>;

  // Write operations (all return Promises)
  add(event: NostrEvent): Promise<NostrEvent>;
  remove(event: string | NostrEvent): Promise<boolean>;
  update?(event: NostrEvent): void;
}
```

## EventStore Integration

The `EventStore` automatically integrates with any database that implements these interfaces:

### With Database (Persistent Storage)

```ts
import { EventStore } from "applesauce-core";
import { BetterSqlite3EventDatabase } from "applesauce-sqlite/better-sqlite3";

// Create a persistent database
const database = new BetterSqlite3EventDatabase("./events.db");

// EventStore automatically uses the database for persistence
const eventStore = new EventStore(database);

// Events are automatically persisted
eventStore.add(someEvent);
```

### Without Database (Memory Only)

```ts
import { EventStore } from "applesauce-core";

// No database provided - uses EventMemory only
const eventStore = new EventStore();

// Events are stored in memory only (lost on restart)
eventStore.add(someEvent);
```

### With Async Database

```ts
import { AsyncEventStore } from "applesauce-core";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";

// Create an async database
const database = new LibsqlEventDatabase("file:./events.db");
await database.initialize();

// Use AsyncEventStore for async databases
const eventStore = new AsyncEventStore(database);

// All operations are async
await eventStore.add(someEvent);
```

## Hybrid Architecture

The EventStore uses a hybrid approach that combines persistent storage with in-memory caching:

### Memory Layer (EventMemory)

- **Purpose**: Ensures single event instances and provides fast access
- **Features**: LRU cache, event deduplication, symbol-based caching
- **Always Present**: Even with a database, EventMemory is used for caching

### Database Layer (Optional)

- **Purpose**: Provides persistent storage between application sessions
- **Features**: Full event persistence, efficient querying, search capabilities
- **Optional**: If not provided, only EventMemory is used

## Event Flow

When an event is added to the EventStore:

1. **EventStore** receives the event and performs high-level processing:
   - Handles kind 5 delete events by removing referenced events
   - Manages replaceable events by removing old versions
   - Validates events if a verification function is provided
   - Tracks expiration timestamps for automatic cleanup

2. **EventMemory** ensures single event instances and provides fast access:
   - Deduplicates events by ID
   - Maintains LRU cache for performance
   - Enables symbol-based caching

3. **Event Database** (if provided) handles persistent storage:
   - Stores events for retrieval between application sessions
   - Provides efficient querying capabilities
   - Maintains indexes for fast filtering

## Key Features

### Event Storage

The primary role of an event database is to store and retrieve Nostr events:

```ts
const eventStore = new EventStore(database);

// Event is stored in the database
const event = eventStore.add(nostrEvent);

// Event can be retrieved after application restart
const retrieved = eventStore.getEvent(event.id);
```

### EventStore Features

The EventStore provides high-level features on top of the database:

#### Delete Event Handling (Kind 5)

```ts
// When a kind 5 delete event is added, EventStore automatically:
// 1. Removes all events referenced in the delete event
// 2. Tracks deleted event IDs to prevent re-adding
const deleteEvent = eventStore.add(kind5DeleteEvent);
// Referenced events are automatically removed from the database
```

#### Replaceable Event Management

```ts
// EventStore automatically removes old versions of replaceable events
const profile1 = eventStore.add(profileEventV1);
const profile2 = eventStore.add(profileEventV2); // Newer version

// Old version is automatically removed from database
// Only the latest version remains accessible
const latestProfile = eventStore.getReplaceable(0, pubkey);
```

#### Event Deduplication

```ts
// EventMemory ensures single event instances
const event1 = eventStore.add(eventFromRelay1);
const event2 = eventStore.add(eventFromRelay2); // Same event, different relay

console.log(event1 === event2); // true - same instance
```

### Efficient Querying

Databases provide optimized querying capabilities:

```ts
// Query events by filters
const notes = eventStore.getByFilters({
  kinds: [1],
  authors: ["pubkey1", "pubkey2"],
});

// Get timeline (chronologically sorted)
const timeline = eventStore.getTimeline({
  kinds: [1],
  limit: 100,
});
```

## Database Implementations

The [`applesauce-sqlite`](/sqlite/index) package provides several database implementations:

### SQLite Implementations

- **Better SQLite3**: High-performance Node.js implementation
- **Native SQLite**: Uses Node.js built-in SQLite module
- **Bun SQLite**: Optimized for Bun runtime
- **LibSQL**: Supports local and remote databases

### Custom Implementations

You can create custom database implementations:

```ts
class CustomEventDatabase implements IEventDatabase {
  hasEvent(id: string): boolean {
    // Your implementation
  }

  getEvent(id: string): NostrEvent | undefined {
    // Your implementation
  }

  add(event: NostrEvent): NostrEvent {
    // Your implementation
  }

  remove(event: string | NostrEvent): boolean {
    // Your implementation
  }

  // ... implement all required methods
}

// Use with EventStore
const customDb = new CustomEventDatabase();
const eventStore = new EventStore(customDb);
```

## Best Practices

### Choose the Right Database

- **Development**: Use memory-only for fast iteration
- **Production**: Use persistent database for data retention
- **High Performance**: Use hybrid approach with optimized database

### Handle Async Databases

```ts
// Always use AsyncEventStore with async databases
const asyncDb = new LibsqlEventDatabase("file:./events.db");
await asyncDb.initialize();

const eventStore = new AsyncEventStore(asyncDb);

// All operations are async
await eventStore.add(event);
const retrieved = await eventStore.getEvent(id);
```

### Memory Management

```ts
// For long-running applications, periodically prune memory
setInterval(() => {
  const pruned = eventStore.prune(1000); // Remove 1000 unclaimed events
  console.log(`Pruned ${pruned} events`);
}, 60000); // Every minute
```
