# Timeline Loader

The Timeline Loader is designed for fetching paginated Nostr events in chronological order. It maintains state between calls, allowing you to efficiently load timeline events in blocks until you reach a specific timestamp or exhaust available events.

The loader automatically deduplicates events by default, so you won't receive the same event multiple times even if it appears on multiple relays or in multiple blocks.

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
  complete: () => console.log("Block loaded"),
});

// Later, load older events by calling the loader again
// Each call continues from where the previous one left off
timelineLoader().subscribe((event) => console.log("Loaded older event:", event));

// Pass a window to load missing events in a specific range
timelineLoader({ since: oldestTimestamp, until: newestTimestamp }).subscribe((event) => console.log(event));
```

## Configuration Options

### Timeline Window

The timeline loader can accept a timeline window to load missing events within a specific range. The window is an object with optional `since` and `until` properties:

```ts
// Load the next block of historical events (default behavior)
// Since defaults to -Infinity, forcing the loader to load new blocks
timelineLoader().subscribe((event) => console.log(event));

// Load events newer than a specific timestamp (backward compatibility)
timelineLoader(1234567890).subscribe((event) => console.log(event));

// Pass a window to load missing events in a specific time range
timelineLoader({ since: oldestTimestamp, until: newestTimestamp }).subscribe((event) => console.log(event));

// Load only newer events (forward in time)
timelineLoader({ until: newestTimestamp }).subscribe((event) => console.log(event));
```

The loader intelligently loads missing blocks of events based on the window you provide:

- **`since`** - Minimum `created_at` timestamp (lower bound of the window). If `undefined`, defaults to `-Infinity` which forces loading new blocks from all relays
- **`until`** - Maximum `created_at` timestamp (upper bound of the window). If `undefined`, only loads historical events going backwards in time

When you pass a window to the loader, it will load any missing events that fall within that range. This allows your app to reactively update the timeline as the user scrolls and the visible window changes.

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

## Using Timeline Windows with Function-Based Loaders

When using the function-based loaders (`createTimelineLoader` and `createOutboxTimelineLoader`), you can pass a timeline window directly to the loader to load missing events:

```ts
import { TimelineWindow } from "applesauce-loaders/loaders";

// As user scrolls, pass the visible window to the loader
const window: TimelineWindow = {
  since: oldestVisibleEvent.created_at,
  until: newestVisibleEvent.created_at,
};

// The loader will automatically load any missing events in this range
timelineLoader(window).subscribe((event) => console.log(event));
```

The timeline loader intelligently loads missing blocks of events when:

- The window expands (user scrolls to older/newer content)
- Events are missing in the current range
- You call the loader with a new window

This approach allows your app to reactively load timeline events as the user scrolls, ensuring that all visible events are fetched.

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

The timeline loader operators watch this window and automatically load missing events when the window changes. This reactive approach means you just update the window observable to reflect what's on screen, and the operators handle fetching the necessary blocks of events.

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

### Window-Based Feed

```ts
const loader = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore, limit: 20 });

// Track the visible window as user scrolls
let currentWindow: TimelineWindow = { since: Date.now() / 1000 };

// Load events for the current window
let subscription = loader(currentWindow).subscribe((event) => {
  events.push(event);
});

// Update window as user scrolls
function updateWindow(since: number, until: number) {
  subscription.unsubscribe();
  currentWindow = { since, until };
  subscription = loader(currentWindow).subscribe((event) => {
    events.push(event);
  });
}
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

// Load events as the window changes
function loadWindow(since: number, until: number) {
  loader({ since, until }).subscribe((event) => events.push(event));
}
```
