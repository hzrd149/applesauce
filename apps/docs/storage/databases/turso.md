---
description: Turso database integration for event storage in Node.js
---

# Turso Implementation

The Turso implementation uses the `@tursodatabase/database` library (version 0.8 or later).

**NOTE**: The `TursoEventDatabase` implements the [`IAsyncEventDatabase`](https://applesauce.build/typedoc/interfaces/applesauce-core.IAsyncEventDatabase.html) interface which means you MUST use the [`AsyncEventStore`](https://applesauce.build/typedoc/classes/applesauce-core.AsyncEventStore.html) instead of the normal [`EventStore`](https://applesauce.build/typedoc/classes/applesauce-core.EventStore.html).

## Installation

```bash
npm install applesauce-sqlite @tursodatabase/database
```

## Basic Usage

`TursoEventDatabase.fromDatabase()` accepts a file path or an existing Turso `Database` and creates the tables:

```js
import { AsyncEventStore } from "applesauce-core";
import { TursoEventDatabase } from "applesauce-sqlite/turso";
import { connect } from "@tursodatabase/database";

const db = await connect("my-database.db");
const database = await TursoEventDatabase.fromDatabase(db);

const eventStore = new AsyncEventStore({ database });
await eventStore.add(someNostrEvent);
```

## Search

Turso does not include the SQLite FTS5 extension, so NIP-50 `search` filters are not supported and throw an error. Use the [LibSQL](./libsql.md) or [Better SQLite3](./better-sqlite3.md) implementations if you need full-text search.

## Closing the Database

Always close the database when done:

```js
await database.close();
```

Or use automatic cleanup with `Symbol.dispose`:

```js
{
  using database = await TursoEventDatabase.fromDatabase("my-database.db");
  // ... use database
} // Automatically closed when out of scope
```
