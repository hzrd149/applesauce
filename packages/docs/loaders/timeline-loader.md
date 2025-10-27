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
```

## Configuration Options

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

## Timeline Window

The timeline window represents the range of timestamps currently visible on screen. It's an observable that emits `{ since?, until? }` objects with the minimum (`since`) and maximum (`until`) `created_at` timestamps of events you want to display.

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

The timeline loader operators watch this window and automatically load missing events when:

- The window expands (user scrolls to older/newer content)
- Events are missing in the current range
- The window is first initialized

This reactive approach means you just update the window to reflect what's on screen, and the loaders handle fetching the necessary blocks.

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

### Paginated Feed

```tsx
const loader = useMemo(() => createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore, limit: 20 }), []);

const loadMore = useCallback(() => {
  setLoading(true);
  loader().subscribe({
    next: (event) => setEvents((prev) => [...prev, event]),
    complete: () => setLoading(false),
  });
}, [loader]);
```

### Social Feed with Outbox Model

```tsx
const contacts$ = new BehaviorSubject<ProfilePointer[]>([]);
const outboxMap$ = contacts$.pipe(map(createOutboxMap));
const window$ = new BehaviorSubject<TimelineWindow>({ since: -Infinity });

// Load blocks using outbox model
const timeline$ = window$.pipe(
  loadBlocksFromOutboxMap(pool, outboxMap$, { kinds: [1] }, { limit: 100 }),
  mapEventsToStore(eventStore),
);

timeline$.subscribe();

// Load more by updating window
function loadMore() {
  window$.next({ since: -Infinity });
}
```
