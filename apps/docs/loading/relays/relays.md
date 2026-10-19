---
description: Relay class for individual relay connections with subscription management and message handling
---

# Relay Class

The `Relay` class provides a reactive interface for connecting to and communicating with Nostr relays using RxJS observables.

## Creating a Relay Connection

```typescript
import { Relay } from "applesauce-relay";

// Create a new relay instance
const relay = new Relay("wss://relay.example.com");

// Access relay state observables
relay.connected$.subscribe((connected) => console.log("Connection status:", connected));

relay.notices$.subscribe((notices) => console.log("Relay notices:", notices));
```

## Notice History

`notices$` and `notices` retain the latest 100 notices from the current connection, ordered oldest to newest. Set `noticeLimit` when creating a relay to change the limit; it must be a finite non-negative integer. Connection resets clear the history, and each update produces a new array without changing previous snapshots.

```typescript
const relay = new Relay("wss://relay.example.com", { noticeLimit: 50 });
relay.notices$.subscribe((notices) => console.log(notices));
```

Use `noticeLimit: 0` to disable history retention. The passive `notice$` stream still emits every incoming notice while the relay connection is active.

### Integration

Pass the same option to [RelayPool](./pool) to configure newly created relay connections:

```typescript
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool({ noticeLimit: 100 });
```

## Subscribing to Events

The `req` or `subscription` methods returns an observable that emits events from the relay.

:::warning
The `req` method will `complete` when the connection closes cleanly or when the relay sends a clean `CLOSED` message. It will `error` for connection errors or error-prefixed relay `CLOSED` messages. For persistent event streams, use `subscription`.
:::

```typescript
// Subscribe to specific kinds of events
relay
  .req({
    kinds: [1],
    authors: ["pubkey1", "pubkey2"],
  })
  .subscribe({
    next: (response) => {
      if (response === "EOSE") {
        console.log("End of stored events");
      } else {
        console.log("Event:", response);
      }
    },
    error: (err) => console.error("Subscription error:", err),
  });
```

## Publishing Events

Send events to the relay using the `event` or `publish` methods.

:::info
The `publish` method is a wrapper around the `event` method that returns a `Promise<PublishResponse>` and automatically handles retrying (default 3 retries with linear backoff).
:::

```typescript
import { generatePrivateKey, getPublicKey, getEventHash, signEvent } from "nostr-tools";

const sk = generatePrivateKey();
const pk = getPublicKey(sk);

const event = {
  kind: 1,
  pubkey: pk,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: "Hello Nostr!",
};

event.id = getEventHash(event);
event.sig = signEvent(event, sk);

// Use the observable method
relay.event(event).subscribe((response) => {
  console.log(`Published: ${response.ok}`, response.message);
});

// Or use the publish method with await
const response = await relay.publish(event);
console.log(`Published: ${response.ok}`, response.message);
```

## Making One-time Requests

Use the `request` method for one-time queries that complete after receiving `EOSE`. The `request` method returns an `Observable<NostrEvent>` that emits individual events and completes when EOSE is received.

```typescript
import { toArray, lastValueFrom } from "rxjs";
import { getProfileContent } from "applesauce-core/helpers";

// Get latest user profile
async function getProfile(pubkey) {
  const events = await lastValueFrom(
    relay
      .request({
        kinds: [0],
        authors: [pubkey],
        limit: 1,
      })
      .pipe(toArray()),
  );

  return getProfileContent(events[0]);
}

// Or subscribe to events as they arrive
relay
  .request({
    kinds: [1],
    authors: [pubkey],
    limit: 10,
  })
  .subscribe({
    next: (event) => console.log("Received event:", event),
    complete: () => console.log("Request complete"),
  });
```

## Persistent Subscriptions

The `subscription` method can be used to create persistent subscriptions. It provides two separate options for handling interruptions:

### Reconnection Options

The `reconnect` option controls whether connection errors should retry the REQ. It does not retry relay `CLOSED` errors such as `rate-limited:` or `blocked:`. It accepts:

- `true` - Retry with the relay default config (3 retries with linear backoff)
- `false` Don't reconnect
- `number` - Reconnect a specific number of times
- `Infinity` - Reconnect infinite times
- `RetryConfig` - Full RxJS retry configuration

```typescript
// Infinite reconnection
const subscription = relay
  .subscription({ kinds: [1] }, { id: "persistent-feed", reconnect: Infinity })
  .subscribe(console.log);

// Only reconnect 5 times
const subscription = relay.subscription({ kinds: [1] }, { id: "limited-feed", reconnect: 5 }).subscribe(console.log);

// Custom reconnection with 2 second delay
const subscription = relay
  .subscription(
    { kinds: [1] },
    {
      id: "custom-feed",
      reconnect: {
        count: 10,
        delay: 2000,
      },
    },
  )
  .subscribe(console.log);
```

### Resubscribe Options

The `resubscribe` option controls how many times the subscription will resubscribe after the relay explicitly closes the REQ with a clean `CLOSED` message. Use `reconnect` for websocket connection errors.

```typescript
// Basic resubscribe with number of attempts
const subscription = relay
  .subscription({ kinds: [1, 6], since: Math.floor(Date.now() / 1000) }, { id: "feed", resubscribe: 3 })
  .subscribe({
    next: (response) => {
      if (response !== "EOSE") {
        console.log("New event:", response.content);
      }
    },
  });

// Advanced resubscribe with custom configuration
const subscription = relay
  .subscription(
    { kinds: [1] },
    {
      id: "advanced-feed",
      resubscribe: {
        count: 5,
        delay: 1000,
      },
    },
  )
  .subscribe(console.log);
```

### How It Works

Under the hood, the `subscription` method uses RxJS operators to implement retry and reconnection logic:

1. **Resubscribe Logic**: Uses the [`repeat()`](https://rxjs.dev/api/operators/repeat) operator only after a clean relay `CLOSED` message, based on the `resubscribe` option
2. **Reconnection Logic**: Uses the [`retry()`](https://rxjs.dev/api/operators/retry) operator for connection errors, based on the `reconnect` option

## Dynamic Filters

The `req`, and `subscription` methods can accept an observable for the filters. this allows for you to set the filters later or update them dynamically.

:::warning
Make sure to use a `ReplaySubject`, `BehaviorSubject`, or the `shareReplay(1)` operator to keep the last filters in case the REQ retries or resubscribes.
:::

```typescript
import { BehaviorSubject } from "rxjs";
import { onlyEvents } from "applesauce-relay/operators";

// Create a subject with initial filters
const filters = new BehaviorSubject({
  kinds: [1],
  limit: 20,
});

// Subscribe using dynamic filters
relay
  .req(filters)
  .pipe(onlyEvents())
  .subscribe((event) => console.log(event.content));

// Update filters later
setTimeout(() => {
  filters.next({
    kinds: [1],
    "#t": ["nostr"],
    limit: 20,
  });
}, 5000);
```

## Protocol Features

- [Authentication](./authentication) - respond to auth challenges and `auth-required:` refusals
- [Counting](./counting) - count events with `count()`
- [Negentropy Sync](./negentropy) - reconcile and transfer events with `negentropy()` and `sync()`
- [Relay Information](./relay-information) - read names, icons, supported NIPs and limits from `information$`

## Observable Properties

The `Relay` class exposes several observable properties for tracking relay state:

```typescript
// Connection state
relay.connected$.subscribe((connected) => {
  console.log("Connected:", connected);
});

// Connection attempts (increments on each reconnection attempt)
relay.attempts$.subscribe((attempts) => {
  console.log("Connection attempts:", attempts);
});

// Last connection error
relay.error$.subscribe((error) => {
  if (error) console.error("Connection error:", error);
});

// All notices from the relay
relay.notices$.subscribe((notices) => {
  console.log("Relay notices:", notices);
});

// Individual notice messages
relay.notice$.subscribe((notice) => {
  console.log("New notice:", notice);
});
```
