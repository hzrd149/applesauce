---
description: Turso WASM database for event storage in browser environments
---

# Turso WASM Implementation

The Turso WASM implementation uses the `@tursodatabase/database-wasm` library (version 0.8 or later), providing SQLite functionality in web browsers and other WASM-compatible environments.

**NOTE**: The `TursoWasmEventDatabase` implements the [`IAsyncEventDatabase`](https://applesauce.build/typedoc/interfaces/applesauce-core.IAsyncEventDatabase.html) interface which means you MUST use the [`AsyncEventStore`](https://applesauce.build/typedoc/classes/applesauce-core.AsyncEventStore.html) instead of the normal [`EventStore`](https://applesauce.build/typedoc/classes/applesauce-core.EventStore.html).

:::info
This implementation uses [`SharedArrayBuffer`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer) and [`OPFS`](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) which require the following server headers to be set:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

:::

## Installation

```bash
npm install applesauce-sqlite @tursodatabase/database-wasm
```

## Basic Usage

Create the Turso database yourself and pass it to `TursoWasmEventDatabase.fromDatabase()`, which creates the tables:

```js
import { AsyncEventStore } from "applesauce-core";
import { TursoWasmEventDatabase } from "applesauce-sqlite/turso-wasm";
import { connect } from "@tursodatabase/database-wasm";

const db = await connect("my-database.db");
const database = await TursoWasmEventDatabase.fromDatabase(db);

const eventStore = new AsyncEventStore({ database });
await eventStore.add(someNostrEvent);
```

When bundling with Vite, import `connect` from `@tursodatabase/database-wasm/vite` instead.

## Search

Turso does not include the SQLite FTS5 extension, so NIP-50 `search` filters are not supported and throw an error.

## Closing the Database

Always close the database when done:

```js
await database.close();
```
