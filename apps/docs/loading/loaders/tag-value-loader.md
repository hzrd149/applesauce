---
description: Batch, cache, and deduplicate requests for events that reference a tag value
---

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
- `maxConcurrentBatches`: Maximum running batches (default 4, `Infinity` disables the limit)
- `relayConcurrency`: Maximum running relay requests per batch (default 8, `Infinity` disables the limit)
- `requestTimeout`: Total lifetime of each cache request, relay request, or extra relay discovery in ms (default 10000, `Infinity` disables the deadline)
- `kinds`: Restrict queries to specific kinds
- `authors`: Restrict queries to specific authors
- `since`: Restrict queries since timestamp
- `cacheRequest`: A method used to load events from a local cache
- `onError`: Receives a failed source’s error and `{ source: "cache" }`, `{ source: "relay", relay }`, or `{ source: "routing" }` while other sources continue
- `extraRelays`: An array (or observable array) of relays to always fetch from
- `eventStore`: An event store used to deduplicate events (defaults to an in-memory store, pass `null` to disable)
- `signal`: An `AbortSignal` that tears down the loader when aborted

Cache and individual relay failures are skipped, including exceptions thrown when starting a request. Events already received remain available, and healthy sources continue until they complete. If every source fails, the loader completes without events; use `onError` to distinguish failures from an empty result. Exceptions thrown by `onError` propagate to subscribers.

With the default limits, one loader runs at most 32 relay requests and four cache requests at once. Relay deadlines start when each request is subscribed, excluding time spent queued. Events do not reset the deadline. A timed-out source is cancelled and reported through `onError`; other sources continue. These limits do not bound the number of queued callers, and observable `extraRelays` discovery uses its own deadline of the same duration.

Started batches continue warming the store after consumers unsubscribe, within their source deadlines. Queued batches whose consumers have all unsubscribed are skipped. Calling `stop()` or aborting `signal` cancels active requests and completes queued callers.

Explicit relay hints start without waiting for observable `extraRelays`. The loader uses the first emitted relay list to request only relay/value pairs not already covered by hints, within the same relay concurrency limit. Empty discovery completes normally; failed or timed-out discovery reports `{ source: "routing" }` through `onError` without cancelling hinted requests.

Set `force: true` on a pointer to skip cache lookup for that caller and receive only relay results. In a mixed batch, ordinary callers can still query the same value from cache; those cache arrivals are excluded from forced callers. A relay arrival is delivered even when the same event arrived from cache first, and ordinary callers still receive that event only once. Relay results may reuse the store’s canonical event object, so `force` does not bypass the event store.

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

## Specialized Loaders

For reactions and zaps on an event, use the prebuilt [Reactions Loader](/loading/loaders/reactions-loader) and [Zaps Loader](/loading/loaders/zaps-loader), which wrap tag value loaders for the `e` and `a` tags.

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

1. Buffer requests and batch them into one filter per relay
2. Load from the cache (if configured) and from the pointer relays plus `extraRelays` in parallel
3. Deduplicate events through the event store (or an in-memory store by default)

This approach ensures efficient event loading with minimal network requests.
