# Native SQLite Implementation

The Native SQLite implementation uses Node.js's built-in `node:sqlite` module, providing a pure JavaScript solution without external dependencies.

## Installation

```bash
npm install applesauce-sqlite
```

No additional dependencies required - uses Node.js built-in modules.

## Basic Usage

```js
import { EventStore } from "applesauce-core";
import { NativeSqliteEventDatabase } from "applesauce-sqlite/native";

// Create a file-based database
const database = new NativeSqliteEventDatabase("./events.db");

// Or create an in-memory database
const database = new NativeSqliteEventDatabase(":memory:");

// Create EventStore with SQLite backend
const eventStore = new EventStore(database);

// Use as normal
eventStore.add(someNostrEvent);
```

## Options

The `NativeSqliteEventDatabase` constructor accepts the following options:

```js
const database = new NativeSqliteEventDatabase("./events.db", {
  search: true, // Enable full-text search (default: false)
  searchContentFormatter: customFormatter, // Custom search content formatter
});
```

### Search Support

Enable full-text search using SQLite's FTS5 extension:

```js
const database = new NativeSqliteEventDatabase("./events.db", {
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
const database = new NativeSqliteEventDatabase("./events.db", {
  search: true,
  searchContentFormatter: (event) => {
    // Extract searchable content from event
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});
```

## Advanced Usage

### Using with Existing Database

You can also use an existing `DatabaseSync` instance:

```js
import { DatabaseSync } from "node:sqlite";
import { NativeSqliteEventDatabase } from "applesauce-sqlite/native";

const db = new DatabaseSync("./my-existing.db");
const database = new NativeSqliteEventDatabase(db, { search: true });
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
  const database = new NativeSqliteEventDatabase("./events.db");
  // ... use database
} // Automatically closed when out of scope
```

## Performance Considerations

- **Pure JavaScript**: No native dependencies, easier deployment
- **Built-in module**: Uses Node.js's native SQLite bindings
- **Good performance**: Generally slower than better-sqlite3 but still efficient
- **Cross-platform**: Works consistently across different Node.js environments

## Example: Complete Application

```js
import { EventStore } from "applesauce-core";
import { ProfileModel, TimelineModel } from "applesauce-core/models";
import { NativeSqliteEventDatabase } from "applesauce-sqlite/native";
import { Relay } from "applesauce-relay";

// Create persistent event store with search
const database = new NativeSqliteEventDatabase("./my-app.db", {
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

Choose Native SQLite when:

- Building Node.js applications
- You prefer built-in modules over external dependencies
- You want a pure JavaScript solution
- You need good performance without native dependencies
- You're deploying to environments where native modules are problematic
