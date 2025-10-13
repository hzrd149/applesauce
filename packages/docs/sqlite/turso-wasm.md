# Turso WASM Implementation

The Turso WASM implementation uses the `@tursodatabase/database-wasm` library, providing SQLite functionality in web browsers and other WASM-compatible environments.

## Installation

```bash
npm install applesauce-sqlite @tursodatabase/database-wasm
```

## Basic Usage

Unlike other implementations, Turso WASM requires you to create and initialize the database instance yourself before passing it to the `TursoWasmEventDatabase` constructor:

```js
import { EventStore } from "applesauce-core";
import { TursoWasmEventDatabase } from "applesauce-sqlite/turso-wasm";
import { connect } from "@tursodatabase/database-wasm";

// Create a database connection
const db = await connect("my-database.db");

// Create and initialize the event database in one step
const database = await TursoWasmEventDatabase.fromDatabase(db);

// Create EventStore with Turso WASM backend
const eventStore = new EventStore(database);

// Use as normal
eventStore.add(someNostrEvent);
```

## Options

The `TursoWasmEventDatabase.fromDatabase()` method accepts the following options:

```js
const database = await TursoWasmEventDatabase.fromDatabase(db, {
  search: true, // Enable full-text search (default: false)
  searchContentFormatter: customFormatter, // Custom search content formatter
});
```

### Search Support

Enable full-text search using SQLite's FTS5 extension:

```js
const database = await TursoWasmEventDatabase.fromDatabase(db, {
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
const database = await TursoWasmEventDatabase.fromDatabase(db, {
  search: true,
  searchContentFormatter: (event) => {
    // Extract searchable content from event
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});
```

## Advanced Usage

### Database Connection Management

The Turso WASM implementation requires you to manage the database connection lifecycle:

```js
import { connect } from "@tursodatabase/database-wasm";

// Create connection
const db = await connect("my-database.db");

// Create and initialize event database in one step
const database = await TursoWasmEventDatabase.fromDatabase(db, { search: true });

// ... use the database

// Close when done
await database.close();
```

### Using with Existing Database Instance

You can use any existing Turso WASM Database instance:

```js
import { connect } from "@tursodatabase/database-wasm";
import { TursoWasmEventDatabase } from "applesauce-sqlite/turso-wasm";

// Your existing database setup
const db = await connect("existing-database.db");

// Create and initialize event database in one step
const database = await TursoWasmEventDatabase.fromDatabase(db, { search: true });
```

### Rebuilding Search Index

If you need to rebuild the search index (e.g., after changing the search formatter):

```js
await database.rebuildSearchIndex();
```

### Closing the Database

Always close the database when done:

```js
await database.close();
```

Or use automatic cleanup with `Symbol.dispose`:

```js
{
  const database = await TursoWasmEventDatabase.fromDatabase(db);
  // ... use database
} // Automatically closed when out of scope
```

## Web Browser Example

Here's a complete example for use in a web browser:

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Nostr Event Database</title>
  </head>
  <body>
    <div id="app"></div>

    <script type="module">
      import { EventStore } from "applesauce-core";
      import { TursoWasmEventDatabase } from "applesauce-sqlite/turso-wasm";
      import { connect } from "@tursodatabase/database-wasm";

      async function initApp() {
        try {
          // Create database connection
          const db = await connect("nostr-events.db");

          // Create and initialize event database with search enabled
          const database = await TursoWasmEventDatabase.fromDatabase(db, {
            search: true,
          });

          // Create event store
          const eventStore = new EventStore(database);

          // Example: Add a test event
          const testEvent = {
            id: "test123",
            kind: 1,
            pubkey: "pubkey123",
            created_at: Math.floor(Date.now() / 1000),
            content: "Hello from Turso WASM!",
            tags: [],
            sig: "signature123",
          };

          await eventStore.add(testEvent);

          // Example: Search events
          const searchResults = eventStore.getByFilters({
            search: "Hello",
            kinds: [1],
          });

          console.log("Search results:", searchResults);

          // Update UI
          document.getElementById("app").innerHTML = `
                    <h1>Nostr Event Database</h1>
                    <p>Database initialized successfully!</p>
                    <p>Found ${searchResults.length} events matching search.</p>
                `;
        } catch (error) {
          console.error("Error initializing app:", error);
          document.getElementById("app").innerHTML = `
                    <h1>Error</h1>
                    <p>Failed to initialize database: ${error.message}</p>
                `;
        }
      }

      initApp();
    </script>
  </body>
</html>
```

## Performance Considerations

- **WASM Environment**: Runs in web browsers and other WASM-compatible environments
- **File-based Storage**: Persistent storage in the browser's IndexedDB or similar
- **Search Enabled**: Adds overhead for indexing, but enables powerful search capabilities
- **Async Operations**: All database operations are asynchronous
- **Memory Usage**: WASM has memory constraints, monitor usage with large datasets

## When to Use

Choose Turso WASM when:

- Building web applications that need SQLite functionality
- You need persistent storage in browsers
- You want to avoid server-side database dependencies
- You're building offline-capable applications
- You need full-text search in a web environment
- You want to use SQLite without Node.js native dependencies

## Limitations

- **WASM Constraints**: Limited by WASM memory and performance characteristics
- **Browser Compatibility**: Requires browsers that support WASM
- **File Size**: The WASM binary adds to your bundle size
- **Async Only**: All operations are asynchronous (no synchronous alternatives)
