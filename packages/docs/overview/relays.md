# Working with Relays

The `applesauce-relay` package provides a flexible api for communicating with Nostr relays, built on top of [RxJS](https://rxjs.dev/).

## Installation

:::code-group

```sh [npm]
npm install applesauce-relay
```

```sh [yarn]
yarn install applesauce-relay
```

```sh [pnpm]
pnpm install applesauce-relay
```

:::

## Single Relays

The `Relay` class can be used to connect to and interact with a single Nostr relay.

:::warning

The observable that is returned from `.req` and `.event` methods will emit an error if the relay fails to connect. You should use the [catchError](https://rxjs.dev/api/index/function/catchError) rxjs operator to handle errors.

:::

```typescript
import { Relay } from "applesauce-relay";

// Create and connect to a relay
const relay = new Relay("wss://relay.example.com");

// Subscribe to events
relay
  .req({
    kinds: [1], // text notes
    limit: 10, // get last 10 events
  })
  .subscribe({
    next: (response) => {
      if (response === "EOSE") {
        console.log("End of stored events");
      } else {
        console.log("Received event:", response);
      }
    },
    error: (error) => {
      console.error("Subscription error:", error);
    },
  });

// Publish an event
const event = {
  kind: 1,
  content: "Hello Nostr!",
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  // ... other required fields
};

relay.event(event).subscribe({
  next: (response) => {
    console.log("Event published:", response.ok);
  },
  error: (error) => {
    console.error("Publishing error:", error);
  },
});
```

## Relay Groups

The `RelayGroup` class can be used to group relays together and subscribe to them as a single relay. It exposes a `.req` and `.event` method like the `Relay` class.

:::info

Relay groups are used inside the `RelayPool` class, If your already using a `RelayPool` you don't need to use them directly.

:::

```typescript
import { RelayGroup } from "applesauce-relay";

const relays = [new Relay("wss://relay1.example.com"), new Relay("wss://relay2.example.com")];

// A relay group is created by passing an array of relays
const group = new RelayGroup(relays);

// And exposes a similar api to the `Relay` class
group
  .req({
    kinds: [1],
    limit: 10,
  })
  .subscribe((response) => console.log(response));

group.event(event).subscribe((response) => console.log(response));
```

## Relay Pools

The `RelayPool` class allows you to connect and subscribe to multiple relays simultaneously.

:::warning

The relay pool does not deduplicate events from multiple relays. if you need deduplication use the [distinct](https://rxjs.dev/api/index/function/distinct) rxjs operator or an [EventStore](./events.md)

:::

```typescript
import { RelayPool } from "applesauce-relay";

// Create a pool
const pool = new RelayPool();

// Define relay URLs
const relays = ["wss://relay1.example.com", "wss://relay2.example.com", "wss://relay3.example.com"];

// Subscribe to events from all relays
pool
  .req(relays, {
    kinds: [1],
    limit: 10,
  })
  .subscribe({
    next: (response) => {
      if (response === "EOSE") {
        console.log("End of stored events");
      } else {
        console.log("Received event:", response);
      }
    },
  });

// Publish to multiple relays
const event = {
  kind: 1,
  content: "Broadcasting to multiple relays!",
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  // ... other required fields
};

pool.event(relays, event).subscribe({
  next: (response) => {
    console.log(`Published to ${response.from}:`, response.ok);
  },
});
```

## Authentication

The `Relay` class supports nip-24 authentication and exposes a `.challenge`, `.authenticated`, and `.auth()` method.

:::info

If relays respond with an `auth-required:` message to subscriptions or event publishes the `Relay` class will remember and wait for authentication before any more subscriptions or events are published to the relay.

:::

```typescript
import { lastValueFrom } from "rxjs";
import { Relay } from "applesauce-relay";

// Create a relay
const relay = new Relay("wss://relay.example.com");

// Subscribe to the auth challenge
relay.challenge$.subscribe(async (challenge) => {
  console.log("Challenge:", challenge);

  // Sign a new auth event using a custom signer
  const event = await signer.signAuth(relay.url, challenge);

  // Send auth event and wait for response
  await lastValueFrom(relay.auth(event));

  console.log(`Authenticated ${relay.authenticated}`);
});
```

## Operators

The `applesauce-relay` package includes a set of rxjs operators for modifying the stream of events from subscriptions.

### onlyEvents

The `onlyEvents` operator filters the stream to only emit Nostr events.

```typescript
import { onlyEvents } from "applesauce-relay/operators";

// Subscribe to events and only emit Nostr events
pool
  .req(relays, {
    kinds: [1],
    limit: 10,
  })
  .pipe(onlyEvents())
  .subscribe((event) => console.log(event.id));
```

### markFromRelay

The `markFromRelay` operator marks all events in the stream as being from a specific relay url.

```typescript
import { getSeenRelays } from "applesauce-core";
import { markFromRelay } from "applesauce-relay/operators";

// Create a new relay instance
const relay = new Relay("wss://relay.example.com");

// Subscribe to events and mark them as coming from a specific relay
relay
  .req({
    kinds: [1],
    limit: 10,
  })
  .pipe(markFromRelay(relay.url))
  .subscribe((event) => console.log(getSeenRelays(event)));
```

### completeOnEose

The `completeOnEose` operator completes the stream when the EOSE message is received. This is useful for fetching batches of events using [`lastValueFrom`](https://rxjs.dev/api/index/function/lastValueFrom) and [`toArray`](https://rxjs.dev/api/index/function/toArray) ( or `toEventStore`) operators.

:::info

The `RelayPool` and `RelayGroup` classes will wait for all relays to send an EOSE (or a timeout) before emitting an `"EOSE"` message.

:::

```typescript
import { completeOnEose } from "applesauce-relay/operators";

// Subscribe to events and complete the stream when EOSE is received
pool
  .req(relays, {
    kinds: [1],
    limit: 10,
  })
  .pipe(completeOnEose())
  .subscribe((event) => console.log(event.id));

// Fetch events, loop over them and wait for completion
await pool
  .req(relays, {
    kinds: [1],
    limit: 10,
  })
  .pipe(completeOnEose())
  .forEach((event) => {
    // Do something with the event
    console.log(event.id);
  });
```

### toEventStore

The `toEventStore` operator adds all events to an [EventStore](./events.md) and returns a sorted array of events with duplicates removed.

```typescript
import { toEventStore } from "applesauce-relay/operators";

// Create an event store
const eventStore = new EventStore();

// Subscribe, add the events to the event store, and return a deduplicated timeline
const timeline = await lastValueFrom(
  pool
    .req(relays, {
      kinds: [1],
      limit: 10,
    })
    .pipe(toEventStore(eventStore)),
);
```
