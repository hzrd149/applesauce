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

- `bufferTime`: Time interval to buffer requests in ms (default 1000)
- `bufferSize`: Max buffer size (default 200)
- `eventStore`: An event store used to deduplicate events
- `cacheRequest`: A method used to load events from a local cache
- `followRelayHints`: Whether to follow relay hints (default true)
- `extraRelays`: An array of relays to always fetch from

:::warning
If an event store is not provided, the loader will not be able to deduplicate events.
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
3. Fetch from additional relays (if configured)

This approach ensures efficient event loading with minimal network requests.
