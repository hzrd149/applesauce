# Better SQLite3 Implementation

The Better SQLite3 implementation uses the `better-sqlite3` library.

## Installation

```bash
npm install applesauce-sqlite better-sqlite3
```

## Basic Usage

```js
import { EventStore } from "applesauce-core";
import { BetterSqlite3EventDatabase } from "applesauce-sqlite/better-sqlite3";

// Create a file-based database
const database = new BetterSqlite3EventDatabase("./events.db");

// Or create an in-memory database
const database = new BetterSqlite3EventDatabase(":memory:");

// Create EventStore with SQLite backend
const eventStore = new EventStore(database);

// Use as normal
eventStore.add(someNostrEvent);
```

## Options

The `BetterSqlite3EventDatabase` constructor accepts the following options:

```js
const database = new BetterSqlite3EventDatabase("./events.db", {
  search: true, // Enable full-text search (default: false)
  searchContentFormatter: customFormatter, // Custom search content formatter
});
```

### Search Support

Enable full-text search using SQLite's FTS5 extension:

```js
const database = new BetterSqlite3EventDatabase("./events.db", {
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
const database = new BetterSqlite3EventDatabase("./events.db", {
  search: true,
  searchContentFormatter: (event) => {
    // Extract searchable content from event
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});
```

## Advanced Usage

### Using with Existing Database

You can also use an existing `better-sqlite3` Database instance:

```js
import Database from "better-sqlite3";
import { BetterSqlite3EventDatabase } from "applesauce-sqlite/better-sqlite3";

const db = new Database("./my-existing.db");
const database = new BetterSqlite3EventDatabase(db, { search: true });
```

### Rebuilding Search Index

If you need to rebuild the search index (e.g., after changing the search formatter):

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
  const database = new BetterSqlite3EventDatabase("./events.db");
  // ... use database
} // Automatically closed when out of scope
```

## Performance Considerations

- **File-based databases**: Persistent storage, slower than in-memory
- **In-memory databases**: Fastest performance, data lost on restart
- **Search enabled**: Adds overhead for indexing, but enables powerful search capabilities
- **Batch operations**: Better SQLite3 supports transactions for better performance with multiple operations

## Example: Complete Application

```js
import { EventStore } from "applesauce-core";
import { ProfileModel, TimelineModel } from "applesauce-core/models";
import { BetterSqlite3EventDatabase } from "applesauce-sqlite/better-sqlite3";
import { Relay } from "applesauce-relay";

// Create persistent event store with search
const database = new BetterSqlite3EventDatabase("./my-app.db", {
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

## When to Use

Choose Better SQLite3 when:

- Building Node.js applications
- You need maximum performance
- You want full-text search capabilities
- You need advanced SQLite features
- You're comfortable with native dependencies
