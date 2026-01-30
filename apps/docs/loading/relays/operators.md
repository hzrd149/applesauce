---
description: RxJS operators for transforming relay messages, filtering events, and managing subscriptions
---

# RxJS Operators

The `applesauce-relay` package provides several RxJS operators to help process and transform streams of events from Nostr relays.

## onlyEvents

The `onlyEvents` operator filters the subscription response stream to only emit Nostr events, removing any "EOSE" (End Of Stored Events) messages.

```typescript
import { onlyEvents } from "applesauce-relay/operators";

// Subscribe to events and only receive Nostr events (no EOSE messages)
relay
  .req({
    kinds: [1],
    limit: 10,
  })
  .pipe(onlyEvents())
  .subscribe((event) => {
    // This will only receive events, not "EOSE" strings
    console.log(event.id);
  });
```

## markFromRelay

The `markFromRelay` operator adds metadata to events indicating which relay they were received from. This is useful for tracking event propagation across the network.

```typescript
import { markFromRelay } from "applesauce-relay/operators";
import { getSeenRelays } from "applesauce-core/helpers";

// Create a new relay instance
const relay = new Relay("wss://relay.example.com");

// Subscribe to events and mark them as coming from this relay
relay
  .req({
    kinds: [1],
    limit: 10,
  })
  .pipe(markFromRelay(relay.url))
  .subscribe((response) => {
    if (typeof response !== "string") {
      // Check which relays this event has been seen on
      console.log(getSeenRelays(response));
    }
  });
```

## completeOnEose

The `completeOnEose` operator completes the subscription stream when an "EOSE" (End Of Stored Events) message is received. This is particularly useful for one-off requests where you want to collect all events and then process them together.

```typescript
import { completeOnEose } from "applesauce-relay/operators";
import { lastValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";

// Method 1: Complete the stream when EOSE is received
relay
  .req({
    kinds: [1],
    limit: 10,
  })
  .pipe(completeOnEose())
  .subscribe({
    next: (event) => console.log(event.id),
    complete: () => console.log("All stored events received"),
  });

// Method 2: Collect all events into an array
const events = await lastValueFrom(
  relay
    .req({
      kinds: [1],
      limit: 10,
    })
    .pipe(completeOnEose(), toArray()),
);

// Method 3: Include the EOSE message in the stream
relay
  .req({
    kinds: [1],
    limit: 10,
  })
  .pipe(completeOnEose(true))
  .subscribe((response) => {
    if (response === "EOSE") {
      console.log("End of stored events");
    } else {
      console.log("Event:", response.id);
    }
  });
```

## storeEvents

The `storeEvents` operator adds all events from the subscription stream to an `EventStore` without filtering or removing duplicates. The stream continues to emit all original messages.

```typescript
import { storeEvents } from "applesauce-relay/operators";
import { EventStore } from "applesauce-core";

// Create an event store
const eventStore = new EventStore();

// Subscribe to events and add them to the store
relay
  .req({
    kinds: [1],
    limit: 10,
  })
  .pipe(storeEvents(eventStore))
  .subscribe((response) => {
    if (response === "EOSE") {
      // Access all events from the store
      const allEvents = eventStore.getAll();
      console.log(`Received ${allEvents.length} events`);
    }
  });
```

## toEventStore

The `toEventStore` operator adds all events to an `EventStore`, removes duplicates, and returns a sorted array of events when the EOSE message is received. This is perfect for fetching and processing a complete set of events.

:::warning
This operator is deprecated. It's recommended to use the `mapEventsToStore` and `mapEventsToTimeline` operators from `applesauce-core/observable` instead.
:::

```typescript
import { toEventStore } from "applesauce-relay/operators";
import { EventStore } from "applesauce-core";
import { lastValueFrom } from "rxjs";

// Create an event store
const eventStore = new EventStore();

// Fetch events, deduplicate, and sort them
const timeline = await lastValueFrom(
  relay
    .req({
      kinds: [1],
      limit: 10,
    })
    .pipe(toEventStore(eventStore)),
);

console.log(`Received ${timeline.length} unique events`);
```

### Recommended alternative

```typescript
import { mapEventsToStore, mapEventsToTimeline } from "applesauce-core/observable";
import { completeOnEose } from "applesauce-relay/operators";
import { EventStore } from "applesauce-core";
import { lastValueFrom } from "rxjs";

// Create an event store
const eventStore = new EventStore();

// Fetch events, deduplicate, and sort them
const timeline = await lastValueFrom(
  relay
    .req({
      kinds: [1],
      limit: 10,
    })
    .pipe(completeOnEose(), mapEventsToStore(eventStore, true), mapEventsToTimeline()),
);

console.log(`Received ${timeline.length} unique events`);
```

## Combining Operators

These operators can be combined to create powerful data processing pipelines:

```typescript
import { markFromRelay, onlyEvents, completeOnEose } from "applesauce-relay/operators";
import { mapEventsToStore, mapEventsToTimeline } from "applesauce-core/observable";
import { EventStore } from "applesauce-core";
import { lastValueFrom } from "rxjs";

// Create an event store
const eventStore = new EventStore();

// Create a relay pool
const pool = new RelayPool();

// Define relay URLs
const relays = ["wss://relay1.example.com", "wss://relay2.example.com"];

// Fetch events from multiple relays, track where they came from,
// deduplicate, and sort them
const timeline = await lastValueFrom(
  pool
    .req(relays, {
      kinds: [1],
      limit: 10,
    })
    .pipe(
      // Mark each event with its source relay
      markFromRelay(relays[0]),
      // Filter out EOSE messages
      onlyEvents(),
      // Complete when all events are received
      completeOnEose(),
      // Store events and remove duplicates
      mapEventsToStore(eventStore, true),
      // Create a sorted timeline
      mapEventsToTimeline(),
    ),
);

console.log(`Received ${timeline.length} unique events`);
```
