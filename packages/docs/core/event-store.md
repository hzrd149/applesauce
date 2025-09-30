# Event Store

The `EventStore` is a reactive event management system that provides high-level features for handling Nostr events, including delete event processing, replaceable event management, and automatic event deduplication.

The EventStore can use any event database for persistence, or fall back to in-memory storage when no database is provided.

## Creating an event store

```ts
import { EventStore } from "applesauce-core";

// Memory-only storage
const eventStore = new EventStore();

// With persistent database
import { BetterSqlite3EventDatabase } from "applesauce-sqlite/better-sqlite3";
const database = new BetterSqlite3EventDatabase("./events.db");
const eventStore = new EventStore(database);
```

> [!INFO]
> It's recommended to only create a single event store for your app

## Adding events

To add events to the event store you can use the [`eventStore.add`](https://hzrd149.github.io/applesauce/typedoc/classes/applesauce-core.EventStore.html#add) method

Adding events to the event store will update any subscriptions that match that event

```ts
eventStore.timeline({kinds: [1]}).subscribe(events => {
  console.log(`timeline updated (${events.length})`)
})

const event = { kind: 1, ... }
eventStore.add(event)
```

### Duplicate and replaceable events

The EventStore automatically handles:

- **Duplicate events**: Same event ID returns the existing instance
- **Replaceable events** (`1xxxx`): Automatically removes old versions when newer ones are added
- **Delete events** (kind 5): Automatically removes referenced events

This allows you to easily deduplicate events from multiple relays and maintain proper event state.

```ts
const incoming = [
  {
    id: "f177c37f...",
    kind: 1,
    content: "",
    pubkey: "c3ae4ad8...",
    created_at: 1733345284,
    tags: [],
    sig: "...",
  },
  {
    id: "efd33141...",
    kind: 1,
    content: "",
    pubkey: "20d29810...",
    created_at: 1733343882,
    tags: [],
    sig: "...",
  },
  // duplicate of #1
  {
    id: "f177c37f...",
    kind: 1,
    content: "",
    pubkey: "c3ae4ad8...",
    created_at: 1733345284,
    tags: [],
    sig: "...",
  },
];

const sub = eventStore.stream({ kinds: [1] }).subscribe((event) => {
  console.log("new event", event);
});

// add first event
eventStore.add(incoming[0]);

// add second event
eventStore.add(incoming[1]);

// add duplicate event
const event = eventStore.add(incoming[2]);

// since the event f177c37f has already been added
// the subscription will not update and the returned event is the original
console.log(event === incoming[0]); // true - same instance
```

## Subscribing

Subscriptions are rxjs [observables](https://rxjs.dev/guide/observable) that update when new events are added to the event store

### Single events

Subscribing to a single event will notify you when the event has been added to the event store or when it is deleted

```ts
const event = {
  content: "Hashtags are useless.",
  created_at: 1733153425,
  id: "000021ba6f5f4da9d1f913c73dcf8fc8347052b4e74e14a2e41101c0f40792c8",
  kind: 1,
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  sig: "6f197e399d1ebae054fbc20570fc8ef113a79afaa6057125170ba81afcecea2449969c9d1dbc61ff50328cae7166e9981734ba29672d9ae45acb675ff45ebd84",
  tags: [["nonce", "8002", "16"]],
};

const sub = eventStore.event("000021ba6f5f4da9d1f913c73dcf8fc8347052b4e74e14a2e41101c0f40792c8").subscribe((event) => {
  // value maybe undefined when the event is not in the event store
  // or if it has been deleted
  if (event) {
    console.log("event has been found", event);
  }
});

eventStore.add(event);
```

### Replaceable events

Subscribing to a replaceable event will notify you when there is a newer version or when it is deleted

```ts
const original = {
  id: "7607adc3934f368bf1a00cb1023e455707a90af94a29c2acf877dffb0ec4c0cb",
  pubkey: "d8dd41ef1e287dfc668d2473fbef8fa9deea5c2ef03947105ef568e68827e7e4",
  created_at: 1733346633,
  kind: 0,
  tags: [],
  content: '{ "name": "john" }',
  sig: "b706636043a64c5d1a07cabf66db08b1374d6efa4558e8832f5b90becb5cba190215a2ec1303e11dac494977801600b012959daa7145fba6d96ae3fcb629759e",
};

const updated = {
  id: "2f54a4491a31451cbe0d296297649af458d89df2f24d7f86d2474fd0607e29a1",
  pubkey: "d8dd41ef1e287dfc668d2473fbef8fa9deea5c2ef03947105ef568e68827e7e4",
  created_at: 1733346633,
  kind: 0,
  tags: [],
  content: '{ "name": "john smith" }',
  sig: "d66ecc0fb2b9170818defb593150563061716bce82d276d07b4b68be9ab542b2d14bb1335eb62971a84be5f315ecf32bdf53000e780a20330f63d7803a1fd95c",
};

eventStore.add(original);

// get the original and listen for any updates
const sub = eventStore
  .replaceable(0, "d8dd41ef1e287dfc668d2473fbef8fa9deea5c2ef03947105ef568e68827e7e4")
  .subscribe((event) => {
    // first event will be the original
    if (event) console.log("Profile Updated", event);
  });

// this will trigger the subscription
eventStore.add(updated);
```

### Streams

A stream subscription takes a filter(s) and returns all events that match and notifies you when there are new events

```ts
const sub = eventStore.stream({ kinds: [1] }).subscribe((event) => {
  console.log("Found text note", event);
});

// or if you only want to subscribe to future events
const sub = eventStore.stream({ kinds: [1] }, true).subscribe((event) => {
  console.log("Found new text note", event);
});
```

### Timelines

A timeline subscription takes a filter(s) and returns a sorted array of events that match the filter(s)

```ts
const timeline = eventStore.timeline({ kinds: [1] }).subscribe((events) => {
  console.log(events);
});

// fetch some events using another library
fetchEvents({ kinds: [1, 0] }, (event) => {
  // timeline will update for each new event
  eventStore.add(event);
});
```

## Fallback event loaders

The event store has three optional loader methods that act as fallbacks when events are not found in the store. These loaders are particularly useful for loading user profiles or other single events on-demand when the UI needs them.

### Setting up custom loaders

You can implement your own loader methods using any Nostr library or relay connection approach:

```ts
import { EventStore } from "applesauce-core";

const eventStore = new EventStore();

// Event loader - loads events by ID
eventStore.eventLoader = async (pointer) => {
  console.log("loading event", pointer);
  const event = await cache.getEventById(pointer.id);

  if (event) return event;
};

// Replaceable loader - loads kind 0, 3, 1xxxx events
eventStore.replaceableLoader = async (pointer) => {
  console.log("loading replaceable event", pointer);
  return await loadReplaceableEvent(pointer.kind, pointer.pubkey);
};

// Addressable loader - loads kind 3xxxx events
eventStore.addressableLoader = async (pointer) => {
  console.log("loading addressable event", pointer);
  const event = await fetchAddressableEvent(pointer.kind, pointer.pubkey, pointer.identifier);
  if (event) return event;
};
```

Now if events are subscribed to and they don't exist in the store, the loaders will be called.

```ts
const sub = eventStore
  .profile("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((profile) => {
    if (profile) console.log("Profile loaded:", profile);
  });

// Console:
// loading replaceable event { kind: 0, pubkey: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d' }
// Profile loaded: { name: 'fiatjaf', ... }
```

The loaders are called automatically and the loaded events are added to the store, making them available for future requests and updating any active subscriptions.

### Using with applesauce-loaders

While you can implement loaders with any Nostr library, the `applesauce-relay` and `applesauce-loaders` packages make it much simpler:

```ts
import { EventStore } from "applesauce-core";
import { createAddressLoader, createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const eventStore = new EventStore();
const pool = new RelayPool();

// Create an address loader that handles all addressable and replaceable events
const addressLoader = createAddressLoader(pool, {
  // Try a local relay first for caching
  cacheRequest: (filters) => pool.relay("ws://localhost:4869").request(filters),
  // Fallback to public relays
  lookupRelays: ["wss://purplepag.es", "wss://relay.damus.io"],
});

// Set loaders on event store
eventStore.addressableLoader = addressLoader;
eventStore.replaceableLoader = addressLoader;

// Create an event loader that loads events by ID
const eventLoader = createEventLoader(pool, {
  // Try a local relay first for caching
  cacheRequest: (filters) => pool.relay("ws://localhost:4869").request(filters),
});

// Set loader on event store
eventStore.eventLoader = eventLoader;
```

## Static Methods

The event store provides several methods to directly access events without creating subscriptions. These methods are useful when you need to check for or retrieve events synchronously.

### Event Management

- `add(event)`: Add a new event to the store
- `remove(event)`: Remove an event from the store
- `update(event)`: Notify the store that an event has been updated

### Checking Event Existence

- `hasEvent(id)`: Check if an event with a specific ID exists in the store
- `hasReplaceable(kind, pubkey, identifier?)`: Check if a replaceable event exists for the given kind and pubkey combination

### Retrieving Events

- `getEvent(id)`: Get a single event by its ID
- `getReplaceable(kind, pubkey, identifier?)`: Get the latest version of a replaceable event
- `getReplaceableHistory(kind, pubkey, identifier?)`: Get the history of all versions of a replaceable event
- `getByFilters(filters)`: Get a set of all events that match the given filter(s)
- `getTimeline(filters)`: Get a sorted array of events that match the given filter(s)

Example usage:

```ts
// Check if an event exists
const exists = eventStore.hasEvent("000021ba6f5f...");

// Get an event by ID
const event = eventStore.getEvent("000021ba6f5f...");

// Get events matching filters
const events = eventStore.getByFilters({ kinds: [1], authors: ["000021ba6f5f..."] });

// Get a timeline of events
const timeline = eventStore.getTimeline({ kinds: [1] });

// Check and get replaceable events
const hasProfile = eventStore.hasReplaceable(0, "000021ba6f5f...");
const profile = eventStore.getReplaceable(0, "000021ba6f5f...");
```
