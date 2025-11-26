# 5. Loading Specific Events with Loaders

Loaders are specialized utilities that help you fetch specific events from relays efficiently. While RelayPool subscriptions are great for real-time feeds, loaders are perfect for loading individual events, user profiles, or addressable events on-demand.

## What are Loaders?

Loaders are functions that:

- **Use the relay pool** to fetch events from multiple relays
- **Load specific events** by ID, address, or other criteria
- **Handle multiple relays** automatically for better reliability
- **Return observables** that complete when the request is complete
- **Integrate with EventStore** to automatically store loaded events

## Event Loader

The `createEventLoader` function creates a loader for fetching events by their IDs.

### Setting up Event Loader

```typescript
import { createEventLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { EventStore } from "applesauce-core";

const pool = new RelayPool();
const eventStore = new EventStore();

// Create an event loader
const eventLoader = createEventLoader(pool, {
  // Add events to the EventStore and deduplicate them
  eventStore,
  // Always check these relays for events
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"],
});
```

### Loading Events by ID

```typescript
// Make a request and subscribe to the result
eventLoader({
  id: "621233a1ad1b91620f0b4a308c2113243a98925909cdb7b26284cbb4d835a18c",
  relays: ["wss://relay.damus.io"],
}).subscribe((event) => {
  console.log("Loaded event:", event.id);
  console.log("Content:", event.content);
  // Event is automatically added to EventStore
});
```

### Loading Multiple Events

Since the event loader returns an observable, you can use the `merge` operator from RxJS to make multiple requests at once.

```typescript
// Make two requests at once and subscribe to the results
merge(
  eventLoader({ id: "621233a1ad1b91620f0b4a308c2113243a98925909cdb7b26284cbb4d835a18c" }),
  eventLoader({ id: "77941979d4c04283fd9b2f0a280749248cbd41babe3a0731c1597a6d54ae7874" }),
).subscribe({
  next: (event) => {
    console.log("Loaded event:", event.id);
  },
  complete: () => {
    console.log("Both requested completed");
  },
});
```

## Address Loader

The `createAddressLoader` function creates a loader for fetching addressable events (kinds 30000-39999) by their `kind`, `pubkey` and optional `identifier`.

### Setting up Address Loader

```typescript
import { createAddressLoader } from "applesauce-loaders/loaders";

// Create an address loader
const addressLoader = createAddressLoader(pool, { eventStore });
```

### Loading Addressable Events

```typescript
// Load a specific addressable event
const pointer = {
  kind: 30023, // Long-form content
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  identifier: "my-article",
  relays: ["wss://relay.damus.io", "wss://nos.lol"],
};

// Create the request and subscribe to the result
addressLoader(pointer).subscribe((event) => {
  console.log("Loaded article:", event.id);
  console.log("Title:", getArticleTitle(event));
});
```

### Loading Multiple

Again, same as the event loader. the address loader returns an observable, so you can use the `merge` operator from RxJS to make multiple requests at once.

```typescript
// Make two requests at once and subscribe to the results
merge(
  addressLoader({ kind: 30023, pubkey: "pubkey1", identifier: "article-1" }),
  addressLoader({ kind: 30023, pubkey: "pubkey2", identifier: "article-2" }),
).subscribe({
  next: (event) => {
    console.log("Loaded addressable event:", event.id);
  },
  complete: () => {
    console.log("All addressable events loaded");
  },
});
```

## Practical Examples

### Loading a User's Profile

```typescript
const addressLoader = createAddressLoader(pool, { eventStore });

function loadUserProfile(pubkey: string, relays: string[]) {
  return addressLoader({ kind: 0, pubkey, relays }).pipe(
    // Take only the first (most recent) profile
    take(1),
    map((event) => getProfileContent(event)),
  );
}

// Usage
loadUserProfile(
  // Pass pubkey
  "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  // And the relays to load from
  ["wss://relay.damus.io", "wss://nos.lol"],
).subscribe((profile) => {
  if (profile) {
    console.log("Profile loaded:", profile.name);
  }
});
```

## Loader Configuration

### Custom Relays

The event loader and address loader both take an `extraRelays` option. This is an array of relays that will always be checked for events.

```typescript
const addressLoader = createEventLoader(pool, {
  eventStore,
  extraRelays: ["wss://relay.damus.io", "wss://nos.lol"],
});
const articleLoader = createAddressLoader(pool, {
  eventStore,
  extraRelays: ["wss://relay.nostr.band", "wss://relay.damus.io"],
});
```

### Timeout Configuration

The event loader and address loader both take a `timeout` option which can be used to configure the timeout for the requests.

```typescript
// Create loader with custom timeout
const eventLoader = createEventLoader(pool, {
  eventStore,
  extraRelays: ["wss://relay.damus.io"],
  timeout: 10000, // 10 second timeout
});
```

### Cache Configuration

The event loader and address loader both take a `cacheRequest` option which is used to load events from a local cache first.

```typescript
// A method to load events from a local cache
async function cacheRequest(filters: Filter[]) {
  // Make a request to your custom local cache
  const events = await localCache.getEventsForFilters(filters);

  // Return the events as an array of events
  return events;
}

// Create the loader with the cache request option
const eventLoader = createEventLoader(pool, { eventStore, cacheRequest });
```

## Key Concepts

- **Loaders fetch specific events** on-demand, unlike subscriptions
- **Results are added to the EventStore** automatically
- **Observables complete** when the request is complete

## Best Practices

### 1. Check EventStore First

```typescript
// Always check if the event is already loaded
const existingEvent = eventStore.getEvent(eventId);
if (existingEvent) {
  // Use existing event
  console.log("Event already loaded:", existingEvent.content);
} else {
  // Load from relays
  eventLoader({ ids: [eventId] }).subscribe(/* ... */);
}
```

### 2. Use Relays in requests

Its better to pass the relays to the request than to use the `extraRelays` option.

```typescript
// Use multiple relays for better reliability
const eventLoader = createEventLoader(pool, { eventStore });

eventLoader({ id: eventId, relays: ["wss://relay.damus.io", "wss://nos.lol"] }).subscribe((event) => {
  console.log("Loaded event:", event.id);
});
```
