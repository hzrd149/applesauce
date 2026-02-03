---
description: Reactive event management system with automatic deduplication, replaceable event handling, and observable subscriptions
---

# Event Store

The `EventStore` is a reactive event management system that provides high-level features for handling Nostr events, including delete event processing, replaceable event management, and automatic event deduplication.

The EventStore can use any event database for persistence, or fall back to in-memory storage when no database is provided.

## Creating an Event Store

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

## Adding Events

To add events to the event store you can use the [`eventStore.add`](https://applesauce.build/typedoc/classes/applesauce-core.EventStore.html#add) method.

Adding events to the event store will update any subscriptions that match that event:

```ts
eventStore.timeline({ kinds: [1] }).subscribe((events) => {
  console.log(`Timeline updated (${events.length} events)`);
});

const event = { kind: 1, content: "Hello, world!", ... };
eventStore.add(event);
```

### Duplicate and Replaceable Events

The EventStore automatically handles:

- **Duplicate events**: Same event ID returns the existing instance
- **Replaceable events** (kinds `0`, `3`, `1xxxx`): Automatically removes old versions when newer ones are added
- **Addressable events** (kind `3xxxx`): Automatically manages versions based on the `d` tag identifier
- **Delete events** (kind `5`): Automatically removes referenced events

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

const sub = eventStore.filters({ kinds: [1] }).subscribe((event) => {
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

## Subscriptions

Subscriptions are rxjs [observables](https://rxjs.dev/guide/observable) that update when new events are added to the event store.

### Single Events

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

### Replaceable Events

Subscribing to a replaceable event will notify you when there is a newer version or when it is deleted:

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
  created_at: 1733346734,
  kind: 0,
  tags: [],
  content: '{ "name": "john smith" }',
  sig: "d66ecc0fb2b9170818defb593150563061716bce82d276d07b4b68be9ab542b2d14bb1335eb62971a84be5f315ecf32bdf53000e780a20330f63d7803a1fd95c",
};

eventStore.add(original);

// Get the original and listen for any updates
const sub = eventStore
  .replaceable(0, "d8dd41ef1e287dfc668d2473fbef8fa9deea5c2ef03947105ef568e68827e7e4")
  .subscribe((event) => {
    // First event will be the original
    if (event) console.log("Profile Updated", event);
  });

// This will trigger the subscription with the updated profile
eventStore.add(updated);
```

### Filters

A filters subscription takes a filter(s) and returns all events that match and notifies you when there are new events

```ts
const sub = eventStore.filters({ kinds: [1] }).subscribe((event) => {
  console.log("Found text note", event);
});

// or if you only want to subscribe to future events
const sub = eventStore.filters({ kinds: [1] }, true).subscribe((event) => {
  console.log("Found new text note", event);
});
```

#### NIP-91 AND Operator Support

The event store supports [NIP-91](https://github.com/nostr-protocol/nips/pull/1365) AND operators in filters using the `&` prefix for tag filters that require ALL values to match:

```ts
// Find events that have BOTH "meme" AND "cat" tags
// and also have "black" OR "white" tags
const sub = eventStore
  .filters({
    kinds: [1],
    "&t": ["meme", "cat"], // Must have BOTH tags (AND)
    "#t": ["black", "white"], // Must have black OR white (OR)
  })
  .subscribe((event) => {
    console.log("Found matching event", event);
  });
```

The AND operator (`&`) takes precedence over OR (`#`), and any tag values used in AND filters are automatically excluded from OR filters to avoid redundancy.

### Timelines

A timeline subscription takes a filter(s) and returns a sorted array of events that match the filter(s)

```ts
const timeline = eventStore.timeline({ kinds: [1] }).subscribe((events) => {
  console.log(events);
});

// or if you only want to subscribe to future events
const timeline = eventStore.timeline({ kinds: [1] }, true).subscribe((events) => {
  console.log("New events:", events);
});

// fetch some events using another library
fetchEvents({ kinds: [1, 0] }, (event) => {
  // timeline will update for each new event
  eventStore.add(event);
});
```

### Addressable Events

Subscribe to an addressable event (kind 3xxxx with a `d` tag identifier):

```ts
const sub = eventStore.addressable({ kind: 30023, pubkey: "...", identifier: "my-article" }).subscribe((article) => {
  if (article) console.log("Article:", article);
});
```

## Helper Subscription Methods

The event store provides convenient helper methods for common subscription patterns:

### Profile

Subscribe to a user's profile (kind 0):

```ts
const sub = eventStore
  .profile("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((profile) => {
    if (profile) console.log("Profile:", profile);
  });
```

### Contacts

Subscribe to a user's contacts (kind 3):

```ts
const sub = eventStore
  .contacts("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((contacts) => {
    console.log("Contacts:", contacts);
  });
```

### Mutes

Subscribe to a user's mutes (kind 10000):

```ts
const sub = eventStore.mutes("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d").subscribe((mutes) => {
  if (mutes) console.log("Muted users:", mutes);
});
```

### Mailboxes

Subscribe to a user's NIP-65 mailboxes (kind 10002):

```ts
const sub = eventStore
  .mailboxes("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((mailboxes) => {
    if (mailboxes) {
      console.log("Inbox relays:", mailboxes.inboxes);
      console.log("Outbox relays:", mailboxes.outboxes);
    }
  });
```

### Blossom Servers

Subscribe to a user's blossom servers (kind 10063):

```ts
const sub = eventStore
  .blossomServers("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((servers) => {
    console.log("Blossom servers:", servers);
  });
```

### Reactions

Subscribe to an event's reactions (kind 7):

```ts
const event = eventStore.getEvent("event-id");
if (event) {
  const sub = eventStore.reactions(event).subscribe((reactions) => {
    console.log("Reactions:", reactions);
  });
}
```

### Thread

Subscribe to a thread of replies:

```ts
const sub = eventStore.thread("event-id").subscribe((thread) => {
  console.log("Thread:", thread);
});
```

### Comments

Subscribe to an event's comments:

```ts
const event = eventStore.getEvent("event-id");
if (event) {
  const sub = eventStore.comments(event).subscribe((comments) => {
    console.log("Comments:", comments);
  });
}
```

## Fallback event loaders

The event store has an optional `eventLoader` method that acts as a fallback when events are not found in the store. This loader is particularly useful for loading user profiles or other single events on-demand when the UI needs them.

### Setting up custom loaders

You can implement your own loader method using any Nostr library or relay connection approach. The `eventLoader` accepts both `EventPointer` (for events by ID) and `AddressPointer` (for addressable/replaceable events):

```ts
import { EventStore } from "applesauce-core";
import { EventPointer, AddressPointer } from "applesauce-core/helpers/pointers";

const eventStore = new EventStore();

// Unified event loader - handles both events by ID and addressable events
eventStore.eventLoader = async (pointer) => {
  // Check if it's an event pointer (has 'id' property)
  if ("id" in pointer) {
    console.log("loading event", pointer.id);
    const event = await cache.getEventById(pointer.id);
    if (event) return event;
  } else {
    // It's an address pointer (has 'kind' and 'pubkey')
    console.log("loading addressable event", pointer);
    const event = await fetchAddressableEvent(pointer.kind, pointer.pubkey, pointer.identifier);
    if (event) return event;
  }
};
```

Now when events are subscribed to and they don't exist in the store, the loader will be called automatically.

```ts
const sub = eventStore
  .profile("3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d")
  .subscribe((profile) => {
    if (profile) console.log("Profile loaded:", profile);
  });

// Console output:
// loading addressable event { kind: 0, pubkey: '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d' }
// Profile loaded: { name: 'fiatjaf', ... }
```

The loader is called automatically and the loaded events are added to the store, making them available for future requests and updating any active subscriptions.

### Using with applesauce-loaders

While you can implement loaders with any Nostr library, the `applesauce-relay` and `applesauce-loaders` packages make it much simpler. The recommended approach is to use the unified event loader:

```ts
import { EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const eventStore = new EventStore();
const pool = new RelayPool();

// Create and assign a unified loader that handles both events by ID and addressable events
createEventLoaderForStore(eventStore, pool, {
  // Try a local relay first for caching
  cacheRequest: (filters) => pool.relay("ws://localhost:4869").request(filters),
  // Fallback to public relays
  lookupRelays: ["wss://purplepag.es", "wss://relay.damus.io"],
  // Extra relays to always load from
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol"],
});
```

Alternatively, you can create separate loaders and assign them manually:

```ts
import { EventStore } from "applesauce-core";
import { createAddressLoader, createEventLoader, createUnifiedEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const eventStore = new EventStore();
const pool = new RelayPool();

// Reuseable cache request function
function cacheRequest(filters: Filter[]) {
  return pool.relay("ws://localhost:4869").request(filters);
}

// Option 1: Use unified loader (recommended)
const unifiedLoader = createUnifiedEventLoader(pool, {
  eventStore,
  cacheRequest,
  lookupRelays: ["wss://purplepag.es", "wss://relay.damus.io"],
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol"],
});

// Note: The unified eventLoader can handle both types, so you only need to set one
eventStore.eventLoader = unifiedLoader;

// Option 2: Use separate loaders
const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest,
  lookupRelays: ["wss://purplepag.es", "wss://relay.damus.io"],
});

const eventLoader = createEventLoader(pool, {
  eventStore,
  cacheRequest,
});

// Create a method that calls the appropriate loader based on the pointer type
eventStore.eventLoader = (pointer) => {
  if (isEventPointer(pointer)) return eventLoader(pointer);
  else return addressLoader(pointer);
};
```

## Configuration Options

The event store has several configuration properties that control its behavior:

### keepOldVersions

By default, the event store removes old versions of replaceable events when newer ones are added. Set this to `true` to keep all versions:

```ts
const eventStore = new EventStore();
eventStore.keepOldVersions = true;
```

### keepExpired

By default, expired events (with an `expiration` tag) are automatically removed when they expire. Set this to `true` to keep expired events:

```ts
const eventStore = new EventStore();
eventStore.keepExpired = true;
```

### verifyEvent

Provide a custom function to verify events before they're added to the store:

```ts
import { verifyEvent } from "nostr-tools";

const eventStore = new EventStore();
eventStore.verifyEvent = (event) => {
  return verifyEvent(event);
};
```

### modelKeepWarm

Controls how long a model should be kept "warm" (in memory) after all subscribers unsubscribe. Default is 60000ms (60 seconds):

```ts
const eventStore = new EventStore();
eventStore.modelKeepWarm = 30000; // Keep models warm for 30 seconds
```

## Event Management Methods

The event store provides several methods to directly manage events.

### add

Adds an event to the store and updates subscriptions. Returns the event that was added (or the existing instance if it's a duplicate), or `null` if the event was rejected:

```ts
const event = { kind: 1, content: "Hello, world!", ... };
const added = eventStore.add(event);

if (added) {
  console.log("Event added:", added.id);
} else {
  console.log("Event was rejected");
}

// You can also specify which relay the event came from
const addedWithRelay = eventStore.add(event, "wss://relay.damus.io");
```

### remove

Remove an event from the store by ID or event object:

```ts
// Remove by ID
const removed = eventStore.remove("event-id");

// Remove by event object
const event = eventStore.getEvent("event-id");
if (event) {
  eventStore.remove(event);
}
```

### removeByFilters

Remove multiple events that match the given filters:

```ts
// Remove all kind 1 events from a specific author
const count = eventStore.removeByFilters({
  kinds: [1],
  authors: ["3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"],
});
console.log(`Removed ${count} events`);
```

### update

Notify the store that an event has been updated (useful when you modify an event's metadata):

```ts
const event = eventStore.getEvent("event-id");
if (event) {
  // Modify the event somehow
  eventStore.update(event);
}
```

## Query Methods

The event store provides several methods to directly access events without creating subscriptions. These methods are useful when you need to check for or retrieve events synchronously.

### hasEvent

Check if an event with a specific ID exists in the store:

```ts
const exists = eventStore.hasEvent("000021ba6f5f...");
if (exists) {
  console.log("Event is in the store");
}
```

### getEvent

Get a single event by its ID:

```ts
const event = eventStore.getEvent("000021ba6f5f...");
if (event) {
  console.log("Found event:", event);
}
```

### hasReplaceable

Check if a replaceable event exists for the given kind and pubkey:

```ts
const hasProfile = eventStore.hasReplaceable(0, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");
```

### getReplaceable

Get the latest version of a replaceable event:

```ts
const profile = eventStore.getReplaceable(0, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");

// For addressable events, include the identifier
const article = eventStore.getReplaceable(30023, "pubkey...", "my-article");
```

### getReplaceableHistory

Get all versions of a replaceable event (only available when `keepOldVersions` is `true`):

```ts
eventStore.keepOldVersions = true;

const versions = eventStore.getReplaceableHistory(
  0,
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
);
if (versions) {
  console.log(`Found ${versions.length} versions`);
  console.log("Latest:", versions[0]);
}
```

### getByFilters

Get all events that match the given filter(s):

```ts
const events = eventStore.getByFilters({
  kinds: [1],
  authors: ["3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"],
});
console.log(`Found ${events.length} events`);

// With NIP-91 AND operators
const filteredEvents = eventStore.getByFilters({
  kinds: [1],
  "&t": ["nostr", "bitcoin"], // Must have BOTH tags
  "#t": ["meme"], // Must also have meme tag
});
```

### getTimeline

Get a sorted array of events that match the given filter(s), sorted by `created_at` descending (newest first):

```ts
const timeline = eventStore.getTimeline({ kinds: [1] });
console.log(`Timeline has ${timeline.length} events`);
console.log("Most recent:", timeline[0]);
```

## Memory Management

The event store includes built-in memory management through a "claim" system that tracks which events are actively being used by subscriptions.

### Claiming Events

The event store automatically claims events when they're used by subscriptions. You can also manually manage claims:

```ts
const event = eventStore.getEvent("event-id");
if (event) {
  // Mark the event as being used by something
  eventStore.claim(event, "my-component");

  // Check if an event is claimed
  const claimed = eventStore.isClaimed(event);

  // Remove a specific claim
  eventStore.removeClaim(event, "my-component");

  // Clear all claims
  eventStore.clearClaim(event);
}
```

### Pruning Unclaimed Events

Remove events that aren't being used by any subscriptions:

```ts
// Remove up to 1000 unclaimed events
const pruned = eventStore.prune(1000);
console.log(`Pruned ${pruned} events`);

// Remove all unclaimed events
const allPruned = eventStore.prune();
```

### Getting Unclaimed Events

Get a generator of unclaimed events (ordered by least recently used):

```ts
for (const event of eventStore.unclaimed()) {
  console.log("Unclaimed event:", event.id);
}
```

## Observable Streams

The event store exposes three observable streams that you can subscribe to directly:

### insert$

Emits when a new event is added to the store:

```ts
eventStore.insert$.subscribe((event) => {
  console.log("New event added:", event.id);
});
```

### update$

Emits when an event is updated:

```ts
eventStore.update$.subscribe((event) => {
  console.log("Event updated:", event.id);
});
```

### remove$

Emits when an event is removed:

```ts
eventStore.remove$.subscribe((event) => {
  console.log("Event removed:", event.id);
});
```

## Integration

### With Event Loaders

```ts
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/"],
});

const profile$ = eventStore.profile(pubkey); // Auto-loads if not in store
```

### With Cache/Persistent Storage

```ts
const cache = await openDB();

persistEventsToCache(eventStore, (events) => addEvents(cache, events));

const cached = await getEventsForFilters(cache, [{ kinds: [0, 3] }]);
cached.forEach((event) => eventStore.add(event));
```

### With RelayPool

```ts
pool
  .relay(relay)
  .subscription({ kinds: [1] })
  .pipe(mapEventsToStore(eventStore))
  .subscribe();
```

### With ActionRunner

```ts
const actions = new ActionRunner(eventStore, factory, publish);

await actions.run(FollowUser, pubkey);
// Reads existing contacts from eventStore
// Auto-saves new event to eventStore (when saveToStore = true)
```

### With React

```tsx
function Profile({ pubkey }) {
  const profile = use$(() => eventStore.profile(pubkey), [pubkey]);
  return <div>{profile?.name}</div>;
}
```

## Best Practices

### Single Instance

```ts
// app.ts
export const eventStore = new EventStore();
```

### Initialize Event Loader Early

```ts
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/"],
});

startApp(); // Safe to start after loader is set up
```

### Use Persistent Database

```ts
const database = new BetterSqlite3EventDatabase("./events.db");
const eventStore = new EventStore(database);
```

### Pre-load Common Events

```ts
const contacts = eventStore.getReplaceable(3, currentUserPubkey);
const followed = contacts?.tags.filter((t) => t[0] === "p").map((t) => t[1]);
followed?.forEach((pubkey) => eventStore.profile(pubkey).subscribe());
```

### Clean Up Subscriptions

```ts
const sub = eventStore.timeline({ kinds: [1] }).subscribe();
sub.unsubscribe(); // Clean up when done
```

### Use Synchronous Methods

```ts
// ✅ Good - use synchronous methods for known events
const event = eventStore.getEvent(id);

// ❌ Avoid - unnecessary subscription
eventStore.event(id).subscribe((event) => {});
```

### Memory Management

```ts
setInterval(() => {
  eventStore.prune(1000); // Remove up to 1000 unclaimed events
}, 3600000);
```

### Verify Events

```ts
import { verifyEvent } from "nostr-tools";

eventStore.verifyEvent = (event) => {
  if (!verifyEvent(event)) return false;
  if (event.kind < 0 || event.kind > 40000) return false;
  return true;
};
```

### Handle Delete Events

```ts
const deleted = eventStore.getByFilters({ kinds: [5] });
const deletedIds = new Set(deleted.flatMap((e) => e.tags.filter((t) => t[0] === "e").map((t) => t[1])));

const validEvents = cachedEvents.filter((e) => !deletedIds.has(e.id));
validEvents.forEach((e) => eventStore.add(e));
```
