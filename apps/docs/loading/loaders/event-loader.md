---
description: Load single Nostr events by ID with relay hints and automatic fallback relays
---

# Event Loader

The Event Loader is a specialized loader for fetching Nostr events by their IDs. It provides an efficient way to batch and deduplicate requests, cache results, and handle relay hints.

:::warning
The observable returned by the Event Loader MUST be subscribed to in order for the request to be made. No request will be sent until you call `.subscribe()` on the returned observable.
:::

## Basic Usage

```ts
import { createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

// Create a relay pool
const pool = new RelayPool();

// Create an event loader (do this once at the app level)
const eventLoader = createEventLoader(pool);

// Later, use the loader to fetch events
eventLoader({
  id: "event_id",
  relays: ["wss://relay.example.com"],
}).subscribe((event) => {
  console.log("Loaded event:", event);
});
```

## Configuration Options

The `createEventLoader` function accepts these options:

- `bufferTime`: Time interval to buffer requests in ms (default 200)
- `bufferSize`: Max buffer size (default 200)
- `eventStore`: An event store used to deduplicate events (defaults to an internal `EventMemory`, `null` disables deduplication)
- `cacheRequest`: A cache callback that may optionally release relay loading before its stream completes
- `followRelayHints`: Whether to follow relay hints (default true)
- `extraRelays`: Relays to ask for events the cache and relay hints didn't resolve
- `maxConcurrentBatches`: The maximum number of batches requesting relays at once (default 4)
- `stageTimeout`: Time in ms before a slow stage gives up and moves on to the next one, `0` disables it (default 10000)
- `signal`: An `AbortSignal` that tears down the loader

:::tip
Pass your app's `EventStore` as `eventStore` so loaded events are added to it, even if the requesting component unsubscribes first.
:::

## Working with Relay Pools

The Event Loader requires a request method for loading Nostr events from relays. You can provide this in multiple ways:

### Using a RelayPool instance

The simplest approach is to pass a RelayPool instance directly:

```ts
import { createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();
const eventLoader = createEventLoader(pool, {
  eventStore,
  cacheRequest,
});
```

### Using a custom request method

You can also provide a custom request method, such as one from nostr-tools:

```ts
import { createEventLoader } from "applesauce-loaders/loaders";
import { SimplePool } from "nostr-tools";

const pool = SimplePool();

// Create a custom request function using nostr-tools
function customRequest(relays, filters) {
  return new Observable((observer) => {
    const sub = pool.subscribeMany(relays, filters, {
      onevent: (event) => observer.next(event),
      eose: () => observer.complete(),
    });

    return () => sub.close();
  });
}

// Create event loader with custom request
const eventLoader = createEventLoader(customRequest, options);
```

## Loading from cache

For improved performance, you can configure the loader to use a local cache:

```ts
import { createEventLoader } from "applesauce-loaders/loaders";
import { openDB, getEventsForFilters } from "nostr-idb";

// Setup a local event cache
const cache = await openDB();

function cacheRequest(filters) {
  return getEventsForFilters(cache, filters);
}

const eventLoader = createEventLoader(pool, {
  cacheRequest,
  eventStore,
});

// Events from cache are automatically marked using markFromCache
eventLoader(pointer).subscribe((event) => {
  if (!isFromCache(event)) {
    // This is a new event from the network
    addEvents(cache, [event]);
  }
});
```

### Blocking and non-blocking cache results

`cacheRequest` still accepts an event, an array, a Promise of either, or an event Observable. No control message is required: completion starts relay loading for unresolved pointers, as before.

An Observable can optionally emit `{ type: "release" }` to start relay loading before the cache finishes:

```ts
import { concat, of } from "rxjs";

const loader = createEventLoader(pool, {
  cacheRequest: (filters) =>
    concat(blockingLookup$(filters), of({ type: "release" } as const), additionalResults$(filters)),
});
```

Emit `release` first for a fully non-blocking cache request. Before release, cache hits remove pointers from the initial relay request; after release, cache results continue arriving without suppressing relay stages. Repeated release messages are ignored, and control messages never reach consumers or the event store.

The loader subscribes to the cache once per batch. `cache: false` bypasses it. Errors or `stageTimeout` end the cache request and release relay loading; the timeout covers the entire cache subscription and is not reset at release. Setting `stageTimeout: 0` disables that bound. After the relay sequence finishes, a batch resolved by either source stops the remaining cache work.

The same protocol works with the address loader, unified loader, and `createEventLoaderForStore`. The social graph loader also honors release, refreshes all requested users from relays, and bounds each cache subscription to 10 seconds. Tag-value and timeline loaders already run caches alongside relays and simply ignore release messages.

## Real-World Example

Here's how you might use the Event Loader in a React application:

```tsx
import { createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";
import { useEffect } from "react";

// Setup at app level
const eventStore = new EventStore();
const pool = new RelayPool();
const eventLoader = createEventLoader(pool, { eventStore });

function EventComponent({ eventId, relays }) {
  const [event, setEvent] = useState<Event | null>(null);

  // Load the event when component mounts
  useEffect(() => {
    const subscription = eventLoader({
      id: eventId,
      relays,
    }).subscribe((event) => setEvent(event));

    return () => subscription.unsubscribe();
  }, [eventId]);

  if (!event) return <div>Loading...</div>;

  return <div>{event.content}</div>;
}
```

## Loading Sequence

The Event Loader follows this sequence when loading events:

1. Attempt to load from cache (if configured)
2. Use relay hints from event pointers (if enabled)
3. Fetch from extra relays (if configured)

Each stage only receives the events earlier stages didn't find, and skips relays that were already asked for that event. A stage that takes longer than `stageTimeout` is ended so the next stage can run.

Requesting an event that is already being loaded joins the running request instead of opening a new one, unless it adds new relay hints or `cache: false`. If a relay limits how many results it returns, the missing events are requested again while each retry makes progress.
