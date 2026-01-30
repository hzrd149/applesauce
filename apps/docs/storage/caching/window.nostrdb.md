---
description: Browser-based event cache using window.nostrdb for local storage
---

# window.nostrdb Package

The `window.nostrdb.js` package is a polyfill that implements the [NIP-DB](https://github.com/hzrd149/nostr-bucket/blob/master/nip.md) specification, providing a `window.nostrdb` API for storing and querying Nostr events locally in web browsers.

## Overview

`window.nostrdb.js` polyfills the `window.nostrdb` API, which browser extensions like [nostr-bucket](https://github.com/hzrd149/nostr-bucket) can provide. When no extension is present, this package uses IndexedDB as a fallback, giving applications a consistent API for local event storage.

The package integrates seamlessly with Applesauce's event store system, providing persistent local caching that improves application performance and enables offline functionality.

:::info Complete API Documentation

For complete API documentation, see the [window.nostrdb.js repository](https://github.com/hzrd149/window.nostrdb.js).

:::

## Key Features

- **Browser Extension or IndexedDB**: Uses browser extension if available, falls back to IndexedDB
- **NIP-DB Compliant**: Implements the complete `window.nostrdb` interface
- **Real-time Subscriptions**: Subscribe to events with live updates
- **User Lookup**: Search for user profiles with configurable providers (Primal, Vertex, Relatr)
- **TypeScript Support**: Full TypeScript definitions included

## Installation

:::code-group

```sh [npm]
npm install window.nostrdb.js
```

```sh [yarn]
yarn install window.nostrdb.js
```

```sh [pnpm]
pnpm install window.nostrdb.js
```

:::

Or via CDN:

```html
<script type="module" src="https://unpkg.com/window.nostrdb.js"></script>
```

## Basic Usage

### Setting Up with Applesauce

Import the package to polyfill `window.nostrdb`, then integrate with Applesauce's event loaders:

```js
import { EventStore } from "applesauce-core";
import { persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import "window.nostrdb.js";

// Create your event store and relay pool
const eventStore = new EventStore();
const pool = new RelayPool();

// Create a cache request function for event loaders
const cacheRequest = (filters) => window.nostrdb.filters(filters);

// Automatically persist new events to the cache
persistEventsToCache(eventStore, (events) => Promise.allSettled(events.map((event) => window.nostrdb.add(event))));

// Use the cache with event loaders
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: ["wss://purplepag.es/", "wss://index.hzrd149.com/"],
});
```

### How It Works

1. **Polyfill Initialization**: Import polyfills `window.nostrdb` if not already provided by a browser extension
2. **Backend Selection**: Automatically uses browser extension or falls back to IndexedDB
3. **Cache Integration**: The `cacheRequest` function uses `window.nostrdb.filters()` which returns a `Promise<NostrEvent[]>` - this queries the cache before event loaders query relays
4. **Event Persistence**: `persistEventsToCache()` automatically saves new events to the cache as they're added to the event store

## Integration Patterns

### With Event Loaders

The most common use case is integrating the cache with Applesauce's event loaders:

```js
import { EventStore } from "applesauce-core";
import { Filter } from "applesauce-core/helpers";
import { persistEventsToCache } from "applesauce-core/helpers";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import "window.nostrdb.js";

const eventStore = new EventStore();
const pool = new RelayPool();

// Create cache request function
const cacheRequest = (filters: Filter[]) => window.nostrdb.filters(filters);

// Persist events to cache
persistEventsToCache(eventStore, (events) =>
  Promise.allSettled(events.map((event) => window.nostrdb.add(event)))
);

// Use cache with event loader
createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: ["wss://relay.example.com"],
});
```

### With Timeline Loaders

You can also use the cache with timeline loaders:

```js
import { createTimelineLoader } from "applesauce-loaders/loaders";
import "window.nostrdb.js";

const cacheRequest = (filters) => window.nostrdb.filters(filters);

// Persist events to cache
persistEventsToCache(eventStore, (events) => Promise.allSettled(events.map((event) => window.nostrdb.add(event))));

// Create timeline loader with cache
const timeline = createTimelineLoader(
  pool,
  ["wss://relay.example.com"],
  { kinds: [1] },
  { eventStore, cache: cacheRequest },
);
```

## Configuration

You can configure the backend and lookup providers before importing:

```js
// Use local relay backend (connects to nostr-bucket extension)
window.nostrdbConfig = {
  localRelays: ["ws://localhost:4869/"],
  lookupProviders: ["primal", "relatr"], // Order of providers to try
};
import "window.nostrdb.js";
```

If no local relay is available, the library automatically falls back to IndexedDB.

## API Reference

The `window.nostrdb` API provides methods for working with events:

```js
// Add event
await window.nostrdb.add(event);

// Get event by ID
const event = await window.nostrdb.event(eventId);

// Get latest replaceable event
const profile = await window.nostrdb.replaceable(0, pubkey);
const list = await window.nostrdb.replaceable(30000, pubkey, "identifier");

// Query events
const events = await window.nostrdb.filters([{ kinds: [1] }]);
const count = await window.nostrdb.count([{ kinds: [1] }]);

// Subscribe to events
const subscription = window.nostrdb.subscribe([{ kinds: [1] }], {
  event: (event) => console.log(event),
  error: (error) => console.error(error),
  complete: () => console.log("Done"),
});
subscription.close();

// Search for users
const users = await window.nostrdb.lookup("satoshi");
```

## Limitations

- **Browser Only**: Only works in browser environments, not in Node.js
- **Storage Limits**: When using IndexedDB fallback, subject to browser storage quotas
- **Extension Dependent**: Full features require nostr-bucket browser extension or IndexedDB fallback

Or via CDN:

```html
<script type="module" src="https://unpkg.com/window.nostrdb.js"></script>
```

## Setup

Import the package to polyfill `window.nostrdb`:

```tsx
import "window.nostrdb.js";
```

Optionally configure the backend before importing:

```tsx
// Use local relay backend (connects to nostr-bucket)
window.nostrdbConfig = {
  localRelays: ["ws://localhost:4869/"],
};
import "window.nostrdb.js";
```

If no local relay is available, the library automatically falls back to IndexedDB.

## Usage with Applesauce

Create a cache request function for event loaders:

```tsx
const cacheRequest = (filters: Filter[]) => window.nostrdb.filters(filters);

createEventLoaderForStore(eventStore, pool, {
  cacheRequest,
  lookupRelays: ["wss://purplepag.es/"],
});
```

Automatically persist new events:

```tsx
persistEventsToCache(eventStore, (events) => Promise.allSettled(events.map((e) => window.nostrdb.add(e))));
```

Use with timeline loaders:

```tsx
const loader = createTimelineLoader(
  pool,
  ["wss://relay.damus.io/"],
  { kinds: [1] },
  { cache: cacheRequest, eventStore, limit: 50 },
);

loader().subscribe();
```

## Direct API Usage

The window.nostrdb API provides several methods for working with events:

```tsx
// Add event
await window.nostrdb.add(event);

// Get event by ID
const event = await window.nostrdb.event(eventId);

// Get replaceable event
const profile = await window.nostrdb.replaceable(0, pubkey);

// Query events
const events = await window.nostrdb.filters([{ kinds: [1] }]);
const count = await window.nostrdb.count([{ kinds: [1] }]);

// Subscribe to events
const sub = window.nostrdb.subscribe([{ kinds: [1] }], {
  event: (e) => console.log(e),
});
sub.close();
```

## Integration

**EventStore + window.nostrdb:**

```tsx
const cacheRequest = (filters: Filter[]) => window.nostrdb.filters(filters);
createEventLoaderForStore(eventStore, pool, { cacheRequest });

persistEventsToCache(eventStore, (events) => Promise.allSettled(events.map((e) => window.nostrdb.add(e))));
```

**Check if event came from cache:**

```tsx
import { isFromCache } from "applesauce-core/helpers";

const fromCache = isFromCache(event);
```

## Best Practices

**Use event loaders for automatic cache fallback:**

```tsx
// ✅ Good - loader checks cache first, then relays
createEventLoaderForStore(eventStore, pool, { cacheRequest });
eventStore.getEvent(id);

// ❌ Bad - manual cache checking
const cached = await window.nostrdb.filters([{ ids: [id] }]);
if (!cached.length) {
  // fetch from relay...
}
```

**Persist all events automatically:**

```tsx
// ✅ Good - centralized persistence
persistEventsToCache(eventStore, (events) => Promise.allSettled(events.map((e) => window.nostrdb.add(e))));

// ❌ Bad - manual persistence scattered
eventStore.add(event);
window.nostrdb.add(event); // Easy to forget
```
