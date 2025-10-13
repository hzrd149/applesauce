# SQLite Package

The `applesauce-sqlite` package provides persistent SQLite database implementations for AppleSauce, allowing you to store Nostr events in a SQLite database instead of keeping them only in memory.

## Overview

This package extends the core `applesauce-core` functionality by replacing the default in-memory event database with persistent SQLite storage. It provides multiple SQLite implementations to suit different runtime environments and requirements.

## Key Features

- **Persistent Storage**: Store Nostr events in a SQLite database that persists between application restarts
- **Hybrid Architecture**: Combines in-memory caching with SQLite persistence for optimal performance
- **Full Compatibility**: Drop-in replacement for the default in-memory event database
- **Efficient Querying**: Optimized SQLite queries for filtering and retrieving Nostr events
- **Search Support**: Optional full-text search capabilities using SQLite's FTS5 extension
- **Multiple Implementations**: Support for different SQLite drivers and runtime environments

## Available Implementations

The package provides several SQLite implementations, each optimized for different environments:

### [Better SQLite3](./better-sqlite3.md)

The most feature-complete implementation using the `better-sqlite3` library. Recommended for Node.js applications.

### [Native SQLite](./native.md)

Uses Node.js's built-in `node:sqlite` module. Good for Node.js applications that prefer built-in modules.

:::info
Deno v2.2 has built-in support fo the `node:sqlite` module. [Example](https://docs.deno.com/examples/sqlite/)
:::

### [Bun SQLite](./bun.md)

Uses Bun's built-in `bun:sqlite` module. Optimized for Bun runtime applications.

### [LibSQL](./libsql.md)

Uses the LibSQL client for local and remote SQLite databases. Supports both local files and remote LibSQL instances.

### [Turso WASM](./turso-wasm.md)

Uses the Turso WASM SQLite implementation for web browsers and WASM-compatible environments. Provides persistent SQLite functionality without native dependencies.

## Installation

Install the package along with your preferred SQLite implementation:

```bash
# For better-sqlite3 (recommended for Node.js)
npm install applesauce-sqlite better-sqlite3

# For libsql (supports local and remote databases)
npm install applesauce-sqlite @libsql/client

# For turso wasm (web browsers and WASM environments)
npm install applesauce-sqlite @tursodatabase/database-wasm

# For bun (uses built-in SQLite)
bun add applesauce-sqlite

# For native Node.js SQLite
npm install applesauce-sqlite
```

## Basic Usage

Most implementations follow the same pattern. Here's a basic example using Better SQLite3:

```js
import { EventStore } from "applesauce-core";
import { BetterSqlite3EventDatabase } from "applesauce-sqlite/better-sqlite3";

// Create a SQLite database (file-based or in-memory)
const database = new BetterSqlite3EventDatabase("./events.db"); // or ":memory:" for in-memory

// Create EventStore with SQLite backend
const eventStore = new EventStore(database);

// Use the event store as normal
eventStore.add(someNostrEvent);

// The events are now persisted to SQLite!
```

**Note**: The Turso WASM implementation requires a different initialization pattern since it can't easily bundle WASM files. It uses a static `fromDatabase()` method for cleaner initialization. See the [Turso WASM documentation](./turso-wasm.md) for details.

## Advanced Features

### Search Support

Enable full-text search capabilities by passing the `search: true` option:

```js
const database = new BetterSqlite3EventDatabase("./events.db", {
  search: true,
});

// Now you can use search filters
const results = eventStore.getByFilters({
  search: "bitcoin lightning",
});
```

### Custom Search Formatters

Customize how content is indexed for search:

```js
const database = new BetterSqlite3EventDatabase("./events.db", {
  search: true,
  searchContentFormatter: (event) => {
    // Custom logic to extract searchable content
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});
```

## Choosing an Implementation

- **Better SQLite3**: Best for Node.js applications requiring maximum performance and features
- **Native SQLite**: Good for Node.js applications preferring built-in modules
- **Bun SQLite**: Optimal for Bun runtime applications
- **LibSQL**: Best for applications requiring remote database support or LibSQL-specific features
- **Turso WASM**: Best for web browsers and WASM environments requiring persistent SQLite functionality

## Migration from In-Memory

Migrating from the default in-memory database is straightforward:

```js
// Before (in-memory)
import { EventStore } from "applesauce-core";
const eventStore = new EventStore();

// After (SQLite)
import { EventStore } from "applesauce-core";
import { BetterSqlite3EventDatabase } from "applesauce-sqlite/better-sqlite3";
const database = new BetterSqlite3EventDatabase("./events.db");
const eventStore = new EventStore(database);
```

The EventStore API remains exactly the same - only the database implementation changes.
