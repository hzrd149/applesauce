# LibSQL Implementation

The LibSQL implementation uses the `@libsql/client` library, providing support for both local SQLite files and remote LibSQL instances.

## Installation

```bash
npm install applesauce-sqlite @libsql/client
```

## Basic Usage

**NOTE**: The `LibsqlEventDatabase` implements the [`IAsyncEventDatabase`](https://applesauce.build/typedoc/interfaces/applesauce-core.IAsyncEventDatabase.html) interface which means you MUST use the [`AsyncEventStore`](https://applesauce.build/typedoc/classes/applesauce-core.AsyncEventStore.html) instead of the normal [`EventStore`](https://applesauce.build/typedoc/classes/applesauce-core.EventStore.html).

### Local Database

```js
import { AsyncEventStore } from "applesauce-core";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";

// Create a local file-based database
const database = new LibsqlEventDatabase("file:./events.db");

// Create EventStore with SQLite backend
const eventStore = new AsyncEventStore(database);

// Initialize the database (required for LibSQL)
await database.initialize();

// Use as normal
eventStore.add(someNostrEvent);
```

### Remote Database

```js
import { AsyncEventStore } from "applesauce-core";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";

// Connect to a remote LibSQL instance
const database = new LibsqlEventDatabase("libsql://your-database.turso.io");

// Create EventStore with SQLite backend
const eventStore = new AsyncEventStore(database);

// Initialize the database
await database.initialize();

// Use as normal
eventStore.add(someNostrEvent);
```

## Options

The `LibsqlEventDatabase` constructor accepts the following options:

```js
const database = new LibsqlEventDatabase("file:./events.db", {
  search: true, // Enable full-text search (default: false)
  searchContentFormatter: customFormatter, // Custom search content formatter
});
```

### Search Support

Enable full-text search using SQLite's FTS5 extension:

```js
const database = new LibsqlEventDatabase("file:./events.db", {
  search: true,
});

await database.initialize();

// Now you can search events
const results = await eventStore.getByFilters({
  search: "bitcoin lightning",
});
```

### Custom Search Formatter

Customize how content is indexed for search:

```js
const database = new LibsqlEventDatabase("file:./events.db", {
  search: true,
  searchContentFormatter: (event) => {
    // Extract searchable content from event
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});

await database.initialize();
```

## Advanced Usage

### Using with Existing Client

You can also use an existing LibSQL `Client` instance:

```js
import { createClient } from "@libsql/client";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";

const client = createClient({
  url: "libsql://your-database.turso.io",
  authToken: "your-auth-token",
});
const database = new LibsqlEventDatabase(client, { search: true });
await database.initialize();
```

### Async Operations

LibSQL operations are asynchronous, so you need to use `await`:

```js
// All database operations are async
await eventStore.add(someNostrEvent);
const event = await eventStore.getEvent(eventId);
const hasEvent = await eventStore.hasEvent(eventId);
```

### Rebuilding Search Index

If you need to rebuild the search index:

```js
await database.rebuildSearchIndex();
```

### Closing the Database

Always close the database when done:

```js
database.close();
```

Or use automatic cleanup with `Symbol.dispose`:

```js
{
  const database = new LibsqlEventDatabase("file:./events.db");
  await database.initialize();
  // ... use database
} // Automatically closed when out of scope
```

## Performance Considerations

- **Remote support**: Can connect to remote LibSQL instances
- **Async operations**: All operations are asynchronous
- **Network latency**: Remote databases have network overhead
- **Local performance**: Local file databases perform similarly to other implementations

## Example: Complete Application

```js
import { AsyncEventStore } from "applesauce-core";
import { ProfileModel, TimelineModel } from "applesauce-core/models";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";
import { Relay } from "applesauce-relay";

// Create persistent event store with search
const database = new LibsqlEventDatabase("file:./my-app.db", {
  search: true,
});
const eventStore = new AsyncEventStore(database);

// Initialize the database
await database.initialize();

// Connect to relay and store events
const relay = new Relay("wss://relay.example.com");

const subscription = relay.subscription([{ kinds: [0, 1] }]).subscribe(async (event) => {
  await eventStore.add(event); // Automatically persisted
});

// Use models with persisted data
const profile = eventStore.model(ProfileModel, "pubkey...");
profile.subscribe(async (parsed) => {
  console.log("Profile loaded from database:", parsed);
});

// Search functionality
const searchResults = await eventStore.getByFilters({
  search: "bitcoin",
  kinds: [1], // Only text notes
});

console.log(`Found ${searchResults.length} notes about bitcoin`);
```

## Remote Database Configuration

### Turso (LibSQL Cloud)

```js
import { createClient } from "@libsql/client";
import { LibsqlEventDatabase } from "applesauce-sqlite/libsql";

const client = createClient({
  url: "libsql://your-database.turso.io",
  authToken: "your-auth-token",
});

const database = new LibsqlEventDatabase(client, { search: true });
await database.initialize();
```

### Self-Hosted LibSQL

```js
const database = new LibsqlEventDatabase("http://localhost:8080");
await database.initialize();
```

## When to Use

Choose LibSQL when:

- You need remote database support
- You're using Turso or other LibSQL services
- You want to share data across multiple instances
- You need async database operations
- You're building distributed applications
- You want to leverage LibSQL-specific features
