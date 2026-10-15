---
description: Load timeline events from multiple relays with pagination, deduplication, and automatic relay selection
---

# Timeline Loader

The Timeline Loader is designed for infinite scrolling timelines. It keeps its position between calls, so each call loads the next page of older events, and it can also fill in newer events since the last load.

Each relay and each filter pages with its own cursor, so a relay with a lower `max_limit` or a filter with fewer events never causes events to be skipped. Events are deduplicated across relays and across calls.

:::warning
The observable returned by the Timeline Loader MUST be subscribed to in order for the request to be made. No request will be sent until you call `.subscribe()` on the returned observable.
:::

## Basic Usage

```ts
import { createTimelineLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";

const pool = new RelayPool();
const eventStore = new EventStore();

// Create a timeline loader
const timelineLoader = createTimelineLoader(
  pool,
  ["wss://relay.damus.io", "wss://nos.lol"],
  { kinds: [1] }, // Load text notes
  { eventStore, limit: 50 },
);

// Initial load - gets the most recent events
timelineLoader().subscribe({
  next: (event) => console.log("Loaded event:", event),
  complete: () => console.log("Page loaded"),
});

// Later, load older events by calling the loader again
// Each call continues from where the previous one left off
timelineLoader().subscribe((event) => console.log("Loaded older event:", event));

// Load the newer events published since the last load
timelineLoader({ until: Infinity }).subscribe((event) => console.log("Loaded newer event:", event));
```

Each call completes once every relay has finished its page, so `lastValueFrom`, `toArray` and `exhaustMap` work as expected. A call made while a page is still loading waits for that page instead of starting another.

## Configuration Options

### Timeline Window

Each call takes an optional window with `since` and `until` timestamps:

```ts
// Load the next page of older events
timelineLoader();

// Load the next page of older events, but only if the timeline hasn't reached this timestamp yet
timelineLoader(oneWeekAgo); // Same as { since: oneWeekAgo }

// Start the timeline at a timestamp (only on the first call)
timelineLoader({ since: -Infinity, until: startTimestamp });

// Load every event newer than the last load, up to now
timelineLoader({ until: Infinity });
```

- **`since`** - How far back to load. Each call loads one page of older events while the timeline is still newer than `since`, and `-Infinity` always loads the next page. Without `since`, no older events are loaded.
- **`until`** - On the first call, the timestamp the timeline starts from (default: now). On later calls, an `until` newer than the last load fills in every newer event up to `until`, and `Infinity` means now.

### Limit

Control how many events to request per block:

```ts
const loader = createTimelineLoader(pool, relays, { kinds: [1] }, { limit: 100 });
```

### Event Store

Pass an `EventStore` to integrate with your app's event management:

```ts
const eventStore = new EventStore();
const loader = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore });
```

:::tip
If you don't provide an `EventStore`, the loader uses an internal `EventMemory` for deduplication. Providing your own `EventStore` allows the loader to integrate with your app's state management and access events from other loaders.
:::

### Cache

Load from local cache alongside relays:

```ts
import { openDB, getEventsForFilters } from "nostr-idb";

const cache = await openDB();
const loader = createTimelineLoader(
  pool,
  relays,
  { kinds: [1] },
  {
    eventStore,
    cache: (filters) => getEventsForFilters(cache, filters),
  },
);
```

## Outbox Model

Load events from each user's preferred relays:

```ts
import { createOutboxTimelineLoader } from "applesauce-loaders/loaders";
import { createOutboxMap } from "applesauce-core/helpers/relay-selection";

const contacts = [...]; // Array of ProfilePointer with relays
const outboxMap = createOutboxMap(contacts);

const loader = createOutboxTimelineLoader(pool, outboxMap, { kinds: [1] }, { eventStore, limit: 100 });

loader().subscribe((event) => console.log(event));
```

### Dynamic Outbox Maps

Pass an Observable for reactive relay selection:

```ts
import { BehaviorSubject, map } from "rxjs";

const contacts$ = new BehaviorSubject<ProfilePointer[]>([]);
const outboxMap$ = contacts$.pipe(map(createOutboxMap));

const loader = createOutboxTimelineLoader(pool, outboxMap$, { kinds: [1] }, { eventStore, limit: 100 });
```

## How Pagination Works

Relays return the newest `limit` events that match a filter, and many relays cap `limit` with their own `max_limit`. A page therefore never proves how far back a relay's events go, so the loader:

- Keeps a separate cursor for each relay and each filter, and only moves it past events that relay actually returned
- Stops loading a relay or filter only when it returns an empty page
- Loads newer events by paging backward from the target down to the last load, so a gap is filled completely rather than with only the newest page
- Requests the oldest second of a page again, so events cut off at the end of a page aren't skipped

A failed or cancelled request doesn't move the cursor, and the next call retries it.

:::warning
If more events share a single `created_at` second than a relay returns in one page, the rest of that second can't be paged by time. The loader skips past that second instead of looping.
:::

## Using Timeline Windows with RxJS Operators

For more advanced use cases, you can use the RxJS operators with an observable window. The timeline window represents the range of timestamps currently visible on screen as an observable that emits `{ since?, until? }` objects:

```ts
import { BehaviorSubject } from "rxjs";
import { TimelineWindow } from "applesauce-loaders/loaders";

// Window starts undefined (no events on screen yet)
const window$ = new BehaviorSubject<TimelineWindow>({});

// As user scrolls, update the window with visible timestamp range
window$.next({
  since: oldestVisibleEvent.created_at,
  until: newestVisibleEvent.created_at,
});
```

The timeline loader operators watch this window and load a page whenever the window extends past what has been loaded. This reactive approach means you just update the window observable to reflect what's on screen.

## RxJS Operators

For advanced use cases, use the stateful RxJS operators directly. These operators track what events have been loaded and automatically trigger new requests when the timeline window changes:

### Load from Relays

```ts
import { BehaviorSubject } from "rxjs";
import { loadBlocksFromRelays, TimelineWindow } from "applesauce-loaders/loaders";

const window$ = new BehaviorSubject<TimelineWindow>({ since: -Infinity });
const events$ = window$.pipe(loadBlocksFromRelays(pool, relays, { kinds: [1] }, { limit: 50 }));

events$.subscribe((event) => console.log(event));
window$.next({ since: -Infinity }); // Triggers loading the next block
```

### Load from Cache

```ts
import { loadBlocksFromCache } from "applesauce-loaders/loaders";

const events$ = window$.pipe(
  loadBlocksFromCache((filters) => getEventsForFilters(cache, filters), { kinds: [1] }, { limit: 50 }),
);
```

### Load from Outbox Map

```ts
import { loadBlocksFromOutboxMap } from "applesauce-loaders/loaders";

const events$ = window$.pipe(loadBlocksFromOutboxMap(pool, outboxMap$, { kinds: [1] }, { limit: 100 }));
```

### Combine Cache and Relays

```ts
import { merge } from "rxjs";
import { mapEventsToStore } from "applesauce-core";

const cache$ = window$.pipe(loadBlocksFromCache(cacheRequest, { kinds: [1] }, { limit: 50 }));
const relays$ = window$.pipe(loadBlocksFromRelays(pool, relays, { kinds: [1] }, { limit: 50 }));
const timeline$ = merge(cache$, relays$).pipe(mapEventsToStore(eventStore));

timeline$.subscribe((event) => console.log(event));
```

## Examples

### Paginated Feed (Simple)

```ts
const loader = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore, limit: 20 });

// Load the next page of older events
function loadMore() {
  loader().subscribe({
    next: (event) => events.push(event),
    complete: () => console.log("Page loaded"),
  });
}
```

### Load More and Newer Events

```ts
const loader = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore, limit: 20 });
const more$ = new Subject<void>();

// exhaustMap ignores clicks until the current page completes
more$.pipe(exhaustMap(() => loader())).subscribe();

// Fill in events published since the last load, e.g. after the app was in the background
loader({ until: Infinity }).subscribe();
```

### Social Feed with Outbox Model (Using RxJS Operators)

```ts
const contacts$ = new BehaviorSubject<ProfilePointer[]>([]);
const outboxMap$ = contacts$.pipe(map(createOutboxMap));
const window$ = new BehaviorSubject<TimelineWindow>({ since: -Infinity });

// Load blocks using outbox model
const timeline$ = window$.pipe(
  loadBlocksFromOutboxMap(pool, outboxMap$, { kinds: [1] }, { limit: 100 }),
  mapEventsToStore(eventStore),
);

timeline$.subscribe((event) => console.log(event));

// Load more by updating window
function loadMore() {
  window$.next({ since: -Infinity });
}
```

### Social Feed with Outbox Model (Using Function Loader)

```ts
const contacts = [...]; // Array of ProfilePointer with relays
const outboxMap = createOutboxMap(contacts);

const loader = createOutboxTimelineLoader(pool, outboxMap, { kinds: [1] }, { eventStore, limit: 20 });

// Load initial block of events
loader().subscribe((event) => events.push(event));

// Load the next page of older events
function loadMore() {
  loader().subscribe((event) => events.push(event));
}
```

## Best Practices

- **Use `exhaustMap` for "load more"** so repeated scroll or click triggers don't stack requests.
- **Keep a live subscription separate.** The loader only loads history. Open your own subscription for live events, and call `loader({ until: Infinity })` to fill the gap after reconnecting.
- **Reuse one loader per timeline.** The cursors live in the loader, so creating a new loader starts again from the newest events.
