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

## Subscribing to Events

The `req` or `subscription` methods returns an observable that emits events from the relay.

:::warning
The `req` method will `complete` when the connection is closed or `error` when the connection has an error. for Persistent subscriptions you should use the `subscription` method.
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
The `publish` method is a wrapper around the `event` method that returns a `Promise<PublishResponse>` and automatically handles reconnecting and retrying (default 10 retries with 1 second delay).
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

## Authentication

The `Relay` class supports [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) authentication and keeps track of the authentication state and challenge.

- `challenge$` - An observable that tracks the authentication challenge from the relay.
- `authenticated$` - An observable that tracks the authentication state of the relay.
- `authenticate` - An async method that can be used to authenticate the relay.

More information about authentication can be found in the [typedocs](https://applesauce.build/typedoc/classes/applesauce-relay.Relay).

```typescript
// Listen for authentication challenges
relay.challenge$.subscribe((challenge) => {
  if (!challenge) return;

  // Using browser extension as signer
  relay
    .authenticate(window.nostr)
    .then(() => {
      console.log("Authentication successful");
    })
    .catch((err) => {
      console.error("Authentication failed:", err);
    });
});
```

If you want to manually build the authentication event you can use the `auth` method to send the event to the relay.

```typescript
import { makeAuthEvent } from "nostr-tools/nip42";

// Listen for authentication challenges
relay.challenge$.subscribe(async (challenge) => {
  if (!challenge) return;

  // Create a new auth event and sign it
  const auth = await window.nostr.signEvent(makeAuthEvent(relay.url, challenge));

  // Send it to the relay and wait for the response
  relay.auth(auth).subscribe({
    next: (response) => {
      console.log("Authentication response:", response);
    },
    error: (err) => {
      console.error("Authentication failed:", err);
    },
  });
});
```

## Persistent Subscriptions

The `subscription` method can be used to create persistent subscriptions that automatically reconnect after connection issues. It provides two key options for handling failures:

### Reconnection Options

The `reconnect` option controls whether the subscription should automatically reconnect when the WebSocket connection is closed. It accepts:

- `true` - Reconnect 10 times with 1 second delay (default)
- `false` Don't reconnect
- `number` - Reconnect a specific number of times
- `Infinity` - Reconnect infinite times with default delay (1s)
- `RetryConfig` - Full RxJS retry configuration

```typescript
// Infinite reconnection with default delay (1s)
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

The `resubscribe` option controls how many times the subscription will resubscribe if the relay explicitly closes the subscription (`CLOSE`). use `reconnect` for websocket connection errors.

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

1. **Resubscribe Logic**: Uses the [`repeat()`](https://rxjs.dev/api/operators/repeat) operator to resubscribe when the subscription is closed based on the `resubscribe` option
2. **Reconnection Logic**: Uses the [`retry()`](https://rxjs.dev/api/operators/retry) operator to restart the subscription when the connection is lost based on the `reconnect` option

## Dynamic Filters

The `req`, and `subscription` methods can accept an observable for the filters. this allows for you to set the filters later or update them dynamically.

:::warning
Make sure to use a `ReplaySubject`, `BehaviorSubject`, or the `shareReplay(1)` operator to keep the last filters in case the relay disconnects and needs to resubscribe.
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

## Counting Events

The `count` method sends a COUNT request to the relay (NIP-45) and returns an observable that emits a single count response:

```typescript
relay.count({ kinds: [1], authors: [pubkey] }).subscribe({
  next: (response) => {
    console.log(`Found ${response.count} events`);
  },
  error: (err) => console.error("Count error:", err),
});

// Or use with async/await
import { lastValueFrom } from "rxjs";

const response = await lastValueFrom(relay.count({ kinds: [1] }));
console.log(`Total events: ${response.count}`);
```

## Negentropy Synchronization

The relay supports efficient event synchronization using Negentropy (NIP-77). There are two methods available:

### negentropy() Method

The `negentropy` method performs low-level Negentropy sync with a custom reconcile function:

```typescript
import { EventStore } from "applesauce-core";

const eventStore = new EventStore();

await relay.negentropy(
  eventStore, // or array of events
  { kinds: [1], authors: [pubkey] },
  async (have, need) => {
    // 'have' = event IDs we have that relay needs
    // 'need' = event IDs relay has that we need
    console.log(`We have ${have.length} events relay needs`);
    console.log(`Relay has ${need.length} events we need`);

    // Implement custom logic to send/receive events
  },
  { signal: abortController.signal },
);
```

### sync() Method

The `sync` method is a higher-level wrapper that automatically handles sending and receiving events:

```typescript
import { SyncDirection } from "applesauce-relay";

// Bidirectional sync (default)
relay.sync(eventStore, { kinds: [1], authors: [pubkey] }).subscribe({
  next: (event) => console.log("Received event:", event),
  complete: () => console.log("Sync complete"),
});

// Only receive events from relay (download)
relay.sync(eventStore, { kinds: [1] }, SyncDirection.RECEIVE).subscribe({
  next: (event) => console.log("Downloaded event:", event),
});

// Only send events to relay (upload)
relay.sync(eventStore, { kinds: [1] }, SyncDirection.SEND).subscribe({
  complete: () => console.log("Upload complete"),
});
```

## Relay Information

The `Relay` class keeps track of the relay information and emits it as an observable from the `information$` property.

```typescript
// Get relay information
relay.information$.subscribe((info) => {
  if (info) {
    console.log("Relay name:", info.name);
    console.log("Supported NIPs:", info.supported_nips);
    console.log("Software:", info.software);

    if (info.limitation) {
      console.log("Max message size:", info.limitation.max_message_length);
    }
  }
});

// Check for specific NIP support
relay.supported$.subscribe((nips) => {
  if (nips?.includes(77)) {
    console.log("Relay supports Negentropy (NIP-77)");
  }
});

// Get relay limitations
relay.limitations$.subscribe((limits) => {
  if (limits) {
    console.log("Max subscriptions:", limits.max_subscriptions);
    console.log("Max filters:", limits.max_filters);
  }
});
```

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

// Authentication challenge from relay
relay.challenge$.subscribe((challenge) => {
  if (challenge) console.log("Auth challenge:", challenge);
});

// Authentication state
relay.authenticated$.subscribe((authenticated) => {
  console.log("Authenticated:", authenticated);
});

// Whether auth is required for reading events
relay.authRequiredForRead$.subscribe((required) => {
  console.log("Auth required for reading:", required);
});

// Whether auth is required for publishing events
relay.authRequiredForPublish$.subscribe((required) => {
  console.log("Auth required for publishing:", required);
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
