---
description: Native Bun SQLite database for high-performance event storage
---

# Bun SQLite Implementation

The Bun SQLite implementation uses Bun's built-in `bun:sqlite` module, providing optimal performance for Bun runtime applications.

## Installation

```bash
bun add applesauce-sqlite
```

No additional dependencies required - uses Bun's built-in SQLite module.

## Basic Usage

```js
import { EventStore } from "applesauce-core";
import { BunSqliteEventDatabase } from "applesauce-sqlite/bun";

// Create a file-based database
const database = new BunSqliteEventDatabase("./events.db");

// Or create an in-memory database
const database = new BunSqliteEventDatabase(":memory:");

// Create EventStore with SQLite backend
const eventStore = new EventStore(database);

// Use as normal
eventStore.add(someNostrEvent);
```

## Options

The `BunSqliteEventDatabase` constructor accepts the following options:

```js
const database = new BunSqliteEventDatabase("./events.db", {
  search: true, // Enable full-text search (default: false)
  searchContentFormatter: customFormatter, // Custom search content formatter
});
```

### Search Support

Enable full-text search using SQLite's FTS5 extension:

```js
const database = new BunSqliteEventDatabase("./events.db", {
  search: true,
});

// Now you can search events
const results = eventStore.getByFilters({
  search: "bitcoin lightning",
});
```

### Custom Search Formatter

Customize how content is indexed for search:

```js
const database = new BunSqliteEventDatabase("./events.db", {
  search: true,
  searchContentFormatter: (event) => {
    // Extract searchable content from event
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});
```

## Advanced Usage

### Using with Existing Database

You can also use an existing Bun `Database` instance:

```js
import { Database } from "bun:sqlite";
import { BunSqliteEventDatabase } from "applesauce-sqlite/bun";

const db = new Database("./my-existing.db");
const database = new BunSqliteEventDatabase(db, { search: true });
```

### Rebuilding Search Index

If you need to rebuild the search index:

```js
database.rebuildSearchIndex();
```

### Closing the Database

Always close the database when done:

```js
database.close();
```

Or use automatic cleanup with `Symbol.dispose`:

```js
{
  const database = new BunSqliteEventDatabase("./events.db");
  // ... use database
} // Automatically closed when out of scope
```

## Performance Considerations

- **Bun optimized**: Designed specifically for Bun runtime
- **Built-in module**: Uses Bun's native SQLite implementation
- **High performance**: Optimized for Bun's architecture
- **Fast startup**: Bun's fast startup times benefit database operations

## Example: Complete Application

```js
import { EventStore } from "applesauce-core";
import { ProfileModel, TimelineModel } from "applesauce-core/models";
import { BunSqliteEventDatabase } from "applesauce-sqlite/bun";
import { Relay } from "applesauce-relay";

// Create persistent event store with search
const database = new BunSqliteEventDatabase("./my-app.db", {
  search: true,
});
const eventStore = new EventStore(database);

// Connect to relay and store events
const relay = new Relay("wss://relay.example.com");

const subscription = relay.subscription([{ kinds: [0, 1] }]).subscribe((event) => {
  eventStore.add(event); // Automatically persisted
});

// Use models with persisted data
const profile = eventStore.model(ProfileModel, "pubkey...");
profile.subscribe((parsed) => {
  console.log("Profile loaded from database:", parsed);
});

// Search functionality
const searchResults = eventStore.getByFilters({
  search: "bitcoin",
  kinds: [1], // Only text notes
});

console.log(`Found ${searchResults.length} notes about bitcoin`);
```

## Bun-Specific Features

### Fast File Operations

Bun's optimized file system operations make database file handling particularly efficient:

```js
// Bun's fast file operations benefit database performance
const database = new BunSqliteEventDatabase("./events.db");
```

### TypeScript Support

Bun's built-in TypeScript support works seamlessly with the SQLite implementation:

```ts
import { BunSqliteEventDatabase } from "applesauce-sqlite/bun";

const database: BunSqliteEventDatabase = new BunSqliteEventDatabase("./events.db");
```

## When to Use

Choose Bun SQLite when:

- Building applications with Bun runtime
- You want optimal performance in Bun environment
- You prefer Bun's built-in modules
- You need fast startup times
- You're using Bun's other features (bundling, testing, etc.)
