# Turso Implementation

The Turso implementation uses the `@tursodatabase/database` library.

## Installation

```bash
npm install applesauce-sqlite @tursodatabase/database
```

## Basic Usage

Unlike other implementations, Turso requires you to create and initialize the database instance yourself before passing it to the `TursoEventDatabase` constructor:

```js
import { EventStore } from "applesauce-core";
import { TursoEventDatabase } from "applesauce-sqlite/turso";
import { connect } from "@tursodatabase/database";

// For local development - simple file path
const db = await connect("my-database.db");

// Create and initialize the event database in one step
const database = await TursoEventDatabase.fromDatabase(db);

// Create EventStore with Turso backend
const eventStore = new EventStore(database);

// Use as normal
eventStore.add(someNostrEvent);
```

## Options

The `TursoEventDatabase.fromDatabase()` method accepts the following options:

```js
const database = await TursoEventDatabase.fromDatabase(db, {
  search: true, // Enable full-text search (default: false)
  searchContentFormatter: customFormatter, // Custom search content formatter
});
```

### Search Support

Enable full-text search using SQLite's FTS5 extension:

```js
const database = await TursoEventDatabase.fromDatabase(db, {
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
const database = await TursoEventDatabase.fromDatabase(db, {
  search: true,
  searchContentFormatter: (event) => {
    // Extract searchable content from event
    return event.content + " " + event.tags.map((t) => t[1]).join(" ");
  },
});
```

## Advanced Usage

### Database Connection Management

The Turso implementation requires you to manage the database connection lifecycle:

```js
import { connect } from "@tursodatabase/database";

// Create connection
const db = await connect("my-database.db");

// Create and initialize event database in one step
const database = await TursoEventDatabase.fromDatabase(db, { search: true });

// ... use the database

// Close when done
await database.close();
```

### Using with Existing Database Instance

You can use any existing Turso Database instance:

```js
import { connect } from "@tursodatabase/database";
import { TursoEventDatabase } from "applesauce-sqlite/turso";

// Your existing database setup
const db = await connect("my-database.db");

// Create and initialize event database in one step
const database = await TursoEventDatabase.fromDatabase(db, { search: true });
```

### Local Development

For local development, you can use a local SQLite file:

```js
import { connect } from "@tursodatabase/database";
import { TursoEventDatabase } from "applesauce-sqlite/turso";

// Local SQLite file
const db = await connect("local.db");

const database = await TursoEventDatabase.fromDatabase(db, { search: true });
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
  const database = await TursoEventDatabase.fromDatabase(db);
  // ... use database
} // Automatically closed when out of scope
```
