---
description: SQLite event cache running in a Web Worker using @snort/worker-relay
---

# Worker Relay

The [`@snort/worker-relay`](https://www.npmjs.com/package/@snort/worker-relay) package runs a Nostr relay inside a Web Worker, backed by `sqlite-wasm` and persisted to the browser's [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system) (OPFS). Because queries and writes happen off the main thread, it works well as a large event cache that doesn't block rendering.

Like other caches, it sits next to the in-memory `EventStore`: event loaders read from it through a `cacheRequest` function, and `persistEventsToCache` writes new events back to it.

:::tip Example

See the [worker relay cache example](https://applesauce.build/examples/#/example/cache/worker-relay) for a complete app.

:::

## Installation

:::code-group

```sh [npm]
npm install @snort/worker-relay
```

```sh [yarn]
yarn add @snort/worker-relay
```

```sh [pnpm]
pnpm add @snort/worker-relay
```

:::

## Starting the Worker

`WorkerRelayInterface` takes a worker script URL or a `Worker` instance. With Vite, bundle the source worker for production and load the prebuilt ESM worker in development:

```ts
import { WorkerRelayInterface } from "@snort/worker-relay";
import WorkerVite from "@snort/worker-relay/src/worker?worker";

const devWorkerUrl = new URL("@snort/worker-relay/dist/esm/worker.mjs", import.meta.url);
const worker = import.meta.env.DEV ? new Worker(devWorkerUrl, { type: "module" }) : new WorkerVite();

const workerRelay = new WorkerRelayInterface(worker);

// Opens the OPFS database and runs migrations
await workerRelay.init({ databasePath: "cache-relay.db" });
```

Wait for `init()` before querying the relay.

## Setting Up with Applesauce

The worker relay speaks Nostr `REQ` commands, so the `cacheRequest` function wraps the filters in a `["REQ", id, ...filters]` tuple:

```ts
import { EventStore } from "applesauce-core";
import { Filter, persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const eventStore = new EventStore();
const pool = new RelayPool();

let reqId = 0;
const cacheRequest = (filters: Filter[]) => workerRelay.query(["REQ", `cache-${reqId++}`, ...filters]);

// Save new events to the worker relay
persistEventsToCache(eventStore, async (events) => {
  await Promise.allSettled(events.map((event) => workerRelay.event(event)));
});

createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});
```

Events returned by `cacheRequest` are marked as coming from the cache, so `isFromCache(event)` works the same as with any other cache.

## Worker Relay API

The `WorkerRelayInterface` methods most useful for caching:

| Method                            | Description                                              |
| --------------------------------- | -------------------------------------------------------- |
| `init({ databasePath })`          | Opens the OPFS database and runs migrations              |
| `query(["REQ", id, ...filters])`  | Returns matching events as a `Promise<NostrEvent[]>`     |
| `event(event)`                    | Saves an event and resolves to an `OkResponse` with `ok` |
| `count(["REQ", id, ...filters])`  | Counts matching events                                   |
| `delete(["REQ", id, ...filters])` | Deletes matching events and returns their ids            |
| `summary()`                       | Returns event counts, including counts per kind          |
| `wipe()`                          | Deletes every event in the database                      |
| `dump()`                          | Exports the SQLite database file as a `Uint8Array`       |

## Integration

### With Timeline Loaders

Pass the same `cacheRequest` to timeline loaders so cached notes load before relay results:

```ts
const timeline = createTimelineLoader(
  pool,
  ["wss://relay.damus.io/"],
  { kinds: [1] },
  { eventStore, cache: cacheRequest, limit: 50 },
);
```

### As an Event Database

The worker relay can also back an `AsyncEventStore` directly by wrapping it in an `IAsyncEventDatabase` adapter. This persists every event instead of caching in front of the synchronous `EventStore`. See the [database worker relay example](https://applesauce.build/examples/#/example/database/worker-relay) for a full adapter.

## Best Practices

### Check `ok` when saving events

`event()` resolves even when the relay rejects an event, so check the response:

```ts
const results = await Promise.allSettled(events.map((e) => workerRelay.event(e)));
const failed = results.filter((r) => r.status === "rejected" || !r.value.ok);
```

### Use one worker per app

Create the worker and call `init()` once at module level, then share the `WorkerRelayInterface` instead of starting a new worker per component.

## Limitations

- **Browser Only**: Requires Web Workers and OPFS, so it does not run in Node.js
- **Bundler Setup**: The worker script and `sqlite-wasm` assets must be served by your bundler
- **Startup Cost**: Loading `sqlite-wasm` and running migrations makes `init()` slower than opening IndexedDB
- **Storage Limits**: Subject to the browser's storage quota for the origin
