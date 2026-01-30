---
description: Unified event loader that handles both event IDs and addressable events
---

# Unified Event Loader

The Unified Event Loader is a single loader that can handle both `EventPointer` and `AddressPointer` types. It automatically routes to the appropriate loader (`createEventLoader` for events by ID, `createAddressLoader` for addressable/replaceable events) based on the pointer type.

This is the **recommended approach** when setting up loaders for an EventStore, as it provides a single loader that works with the unified `eventLoader` property.

:::warning
The observable returned by the Unified Event Loader MUST be subscribed to in order for the request to be made. No request will be sent until you call `.subscribe()` on the returned observable.
:::

## Basic Usage

```ts
import { createUnifiedEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";

// Create a relay pool and event store
const pool = new RelayPool();
const eventStore = new EventStore();

// Create a unified event loader (do this once at the app level)
const unifiedLoader = createUnifiedEventLoader(pool, {
  eventStore,
  bufferTime: 1000,
  followRelayHints: true,
  extraRelays: ["wss://relay.example.com"],
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Load an event by ID
unifiedLoader({
  id: "2650f6292166624f45795248edb9ca136c276a3d10a0d8f4efd2b8b23eb2d5fc",
  relays: ["wss://relay.example.com"],
}).subscribe((event) => {
  console.log("Loaded event:", event);
});

// Load an addressable event
unifiedLoader({
  kind: 0,
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  relays: ["wss://relay.example.com"],
}).subscribe((event) => {
  console.log("Loaded profile:", event);
});
```

## Using with EventStore

The most common use case is to set up the unified loader with an EventStore. The `createEventLoaderForStore` convenience function makes this easy:

```ts
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { EventStore } from "applesauce-core";
import { RelayPool } from "applesauce-relay";

const eventStore = new EventStore();
const pool = new RelayPool();

// Create and assign the loader in one step (recommended)
createEventLoaderForStore(eventStore, pool, {
  bufferTime: 1000,
  followRelayHints: true,
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol"],
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Now the event store can automatically load both events by ID and addressable events
eventStore.event({ id: "event_id" }).subscribe((event) => {
  console.log("Loaded event:", event);
});

eventStore.replaceable({ kind: 0, pubkey: "pubkey" }).subscribe((profile) => {
  console.log("Loaded profile:", profile);
});

eventStore
  .addressable({
    kind: 30023,
    pubkey: "pubkey",
    identifier: "article-id",
  })
  .subscribe((article) => {
    console.log("Loaded article:", article);
  });
```

## Configuration Options

The `createUnifiedEventLoader` function accepts all options from both `EventPointerLoaderOptions` and `AddressLoaderOptions`:

### Common Options

- `bufferTime`: Time interval to buffer requests in ms (default 1000)
- `bufferSize`: Max buffer size (default 200)
- `eventStore`: An event store used to deduplicate events
- `cacheRequest`: A method used to load events from a local cache
- `followRelayHints`: Whether to follow relay hints (default true)
- `extraRelays`: An array of relays to always fetch from

### Address Loader Specific Options

- `lookupRelays`: Fallback lookup relays to check when event can't be found

:::warning
If an event store is not provided, the loader will not be able to deduplicate events.
:::

## Working with Relay Pools

The Unified Event Loader requires a request method for loading Nostr events from relays. You can provide this in multiple ways:

### Using a RelayPool instance

The simplest approach is to pass a RelayPool instance directly:

```ts
import { createUnifiedEventLoader, createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";

const pool = new RelayPool();
const eventStore = new EventStore();

// Option 1: Use convenience function
createEventLoaderForStore(eventStore, pool, {
  eventStore,
  cacheRequest,
});

// Option 2: Create and assign manually
const unifiedLoader = createUnifiedEventLoader(pool, {
  eventStore,
  cacheRequest,
});
eventStore.eventLoader = unifiedLoader;
```

### Using a custom request method

You can also provide a custom request method, such as one from nostr-tools:

```ts
import { createUnifiedEventLoader } from "applesauce-loaders/loaders";
import { SimplePool } from "nostr-tools";
import { Observable } from "rxjs";

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

// Create unified loader with custom request
const unifiedLoader = createUnifiedEventLoader(customRequest, options);
```

## Loading from cache

For improved performance, you can configure the loader to use a local cache:

```ts
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { EventStore } from "applesauce-core";
import { RelayPool } from "applesauce-relay";
import { openDB, getEventsForFilters } from "nostr-idb";

// Setup a local event cache
const cache = await openDB();
const eventStore = new EventStore();
const pool = new RelayPool();

function cacheRequest(filters) {
  return getEventsForFilters(cache, filters);
}

// Create loader with cache
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: ["wss://purplepag.es", "wss://index.hzrd149.com"],
});

// Events from cache are automatically marked
eventStore.event({ id: "event_id" }).subscribe((event) => {
  if (!isFromCache(event)) {
    // This is a new event from the network
    addEvents(cache, [event]);
  }
});
```

## How It Works

The Unified Event Loader automatically detects the pointer type and routes to the appropriate loader:

- **EventPointer** (has `id` property) → uses `createEventLoader` internally
- **AddressPointer** (has `kind` and `pubkey` properties) → uses `createAddressLoader` internally

This means you get all the benefits of both loaders (batching, caching, relay hints, etc.) in a single interface.
