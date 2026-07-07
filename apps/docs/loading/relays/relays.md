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

## Authentication

The `Relay` class supports [NIP-42](https://github.com/nostr-protocol/nips/blob/master/42.md) authentication and keeps track of the authentication state and challenge.

- `challenge$` - An observable that tracks the authentication challenge from the relay.
- `authenticated$` - An observable that emits true when at least one user is authenticated.
- `authentications$` - An observable of all authentication attempts on the connection, keyed by pubkey.
- `authenticatedPubkeys$` - An observable of the pubkeys that are currently authenticated.
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
  const response = await relay.auth(auth);
  console.log("Authentication response:", response);
});
```

### Multiple users

A single connection can authenticate multiple users by calling `authenticate` (or `auth`) once per signer. Each authentication is tracked separately by pubkey.

```typescript
await relay.authenticate(aliceSigner);
await relay.authenticate(bobSigner);

relay.isAuthenticated(alice); // true
relay.isAuthenticated([alice, bob]); // true, all pubkeys authenticated
```

The `waitForAuth` option on `req`, `subscription`, `request`, and `publish` accepts a pubkey or array of pubkeys to wait for specific users to be authenticated before retrying an `auth-required:` response.

```typescript
// Only send the REQ once both users are authenticated
relay.subscription({ kinds: [1059], "#p": [alice, bob] }, { waitForAuth: [alice, bob] });
```

> [!NOTE]
> Support for multiple authenticated users on one connection varies between relay implementations; some relays only honor the most recent AUTH.

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
