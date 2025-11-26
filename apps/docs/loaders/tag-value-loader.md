# Tag Value Loader

The Tag Value Loader is a specialized loader for fetching Nostr events by their tag values. It provides an efficient way to batch and deduplicate requests, cache results, and handle relay hints.

:::warning
The observable returned by the Tag Value Loader MUST be subscribed to in order for the request to be made. No request will be sent until you call `.subscribe()` on the returned observable.
:::

## Basic Usage

```ts
import { createTagValueLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

// Create a relay pool
const pool = new RelayPool();

// Create a tag value loader for a specific tag (do this once at the app level)
const eTagLoader = createTagValueLoader(pool, "e");

// Later, use the loader to fetch events by tag value
eTagLoader({
  value: "event_id",
  relays: ["wss://relay.example.com"],
}).subscribe((event) => {
  console.log("Loaded event:", event);
});
```

## Configuration Options

The `createTagValueLoader` function accepts these options:

- `bufferTime`: Time interval to buffer requests in ms (default 1000)
- `bufferSize`: Max buffer size (default 200)
- `kinds`: Restrict queries to specific kinds
- `authors`: Restrict queries to specific authors
- `since`: Restrict queries since timestamp
- `cacheRequest`: A method used to load events from a local cache
- `extraRelays`: An array of relays to always fetch from
- `eventStore`: An event store used to deduplicate events

:::warning
If an event store is not provided, the loader will not be able to deduplicate events.
:::

## Working with Relay Pools

The Tag Value Loader requires a request method for loading Nostr events from relays. You can provide this in multiple ways:

### Using a RelayPool instance

The simplest approach is to pass a RelayPool instance directly:

```ts
import { createTagValueLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();
const eTagLoader = createTagValueLoader(pool, "e", {
  eventStore,
  cacheRequest,
});
```

### Using a custom request method

You can also provide a custom request method, such as one from nostr-tools:

```ts
import { createTagValueLoader } from "applesauce-loaders/loaders";
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

// Create tag value loader with custom request
const eTagLoader = createTagValueLoader(customRequest, "e", options);
```

## Loading from cache

For improved performance, you can configure the loader to use a local cache:

```ts
import { createTagValueLoader } from "applesauce-loaders/loaders";
import { openDB, getEventsForFilters } from "nostr-idb";

// Setup a local event cache
const cache = await openDB();

function cacheRequest(filters) {
  return getEventsForFilters(cache, filters);
}

const eTagLoader = createTagValueLoader(pool, "e", {
  cacheRequest,
  eventStore,
});

// Events from cache are automatically marked using markFromCache
eTagLoader({ value: "event_id" }).subscribe((event) => {
  if (!isFromCache(event)) {
    // This is a new event from the network
    addEvents(cache, [event]);
  }
});
```

## Creating Specialized Loaders

The Tag Value Loader can be used to create specialized loaders for specific use cases:

### Reactions Loader

```ts
import { createTagValueLoader } from "applesauce-loaders/loaders";
import { kinds } from "nostr-tools";
import { getReplaceableAddress, isReplaceable, getSeenRelays, mergeRelaySets } from "applesauce-core/helpers";

function createReactionsLoader(pool, options) {
  // Create tag value loaders for both events and addressable events
  const eventLoader = createTagValueLoader(pool, "e", { ...options, kinds: [kinds.Reaction] });
  const addressableLoader = createTagValueLoader(pool, "a", { ...options, kinds: [kinds.Reaction] });

  // Return a function that uses the appropriate loader based on event type
  return (event, relays) => {
    // Use addressable loader for replaceable events, otherwise use event loader
    return isReplaceable(event.kind)
      ? addressableLoader({ value: getReplaceableAddress(event), relays })
      : eventLoader({ value: event.id, relays });
  };
}
```

### Zaps Loader

```ts
import { createTagValueLoader } from "applesauce-loaders/loaders";
import { kinds } from "nostr-tools";
import { getReplaceableAddress, isReplaceable, getSeenRelays, mergeRelaySets } from "applesauce-core/helpers";

function createZapsLoader(pool, options) {
  // Create tag value loaders for both events and addressable events
  const eventLoader = createTagValueLoader(pool, "e", { ...options, kinds: [kinds.Zap] });
  const addressableLoader = createTagValueLoader(pool, "a", { ...options, kinds: [kinds.Zap] });

  // Return a function that uses the appropriate loader based on event type
  return (event, relays) => {
    // Use addressable loader for replaceable events, otherwise use event loader
    return isReplaceable(event.kind)
      ? addressableLoader({ value: getReplaceableAddress(event), relays })
      : eventLoader({ value: event.id, relays });
  };
}
```

## Real-World Example

Here's how you might use the Tag Value Loader in a React application to fetch replies to a note:

```tsx
import { EventStore } from "applesauce-core";
import { createTagValueLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { useEffect, useState } from "react";

// Setup at app level
const eventStore = new EventStore();
const pool = new RelayPool();
const eTagLoader = createTagValueLoader(pool, "e", { eventStore });

function RepliesComponent({ noteId, relays }) {
  const [replies, setReplies] = useState([]);

  // Load replies when component mounts
  useEffect(() => {
    const subscription = eTagLoader({
      value: noteId,
      relays,
    }).subscribe((event) => {
      // Only add replies that reference this note in the root tag
      if (event.tags.some((tag) => tag[0] === "e" && tag[1] === noteId && tag[3] === "root")) {
        setReplies((prev) => [...prev, event]);
      }
    });

    return () => subscription.unsubscribe();
  }, [noteId]);

  return (
    <div>
      <h3>Replies ({replies.length})</h3>
      {replies.map((reply) => (
        <div key={reply.id}>
          <p>{reply.content}</p>
        </div>
      ))}
    </div>
  );
}
```

## Loading Sequence

The Tag Value Loader follows this sequence when loading events:

1. Attempt to load from cache (if configured)
2. Fetch from specified relays and any additional relays
3. Deduplicate events (if an event store is configured)

This approach ensures efficient event loading with minimal network requests.
