---
description: Track relay connection health and liveness with automatic reconnection and status monitoring
---

# Relay Liveness Tracking

The `RelayLiveness` class helps you track recent connection states of Nostr relays to enable blacklisting of offline or dead relays. It monitors recent connection failures, implements backoff strategies, and provides observables to filter out unhealthy relays from your applications.

**NOTE:** This class is optimized for connecting to relays in a web browser. it has not been tested with less restrictive environments like node.js or bun.

## Key Concepts

:::info
The `RelayLiveness` class does **not** prevent connections to unhealthy relays. It only tracks recent connection states and provides tools to blacklist offline or dead relays. You must explicitly use the filtering methods or RxJS operators to avoid connecting to blacklisted relays.
:::

### Connection States

Relays can be in one of three connection states based on recent connection attempts:

- **`online`**: Relay is responding normally to recent connection attempts
- **`offline`**: Relay is experiencing recent failures but may recover
- **`dead`**: Relay has failed too many times recently and is blacklisted

### Backoff Strategy

When a relay fails, it enters a backoff period where it won't be retried immediately. The backoff duration increases exponentially with each failure, up to a maximum delay.

## Basic Usage

### Creating a Liveness Tracker

```typescript
import { RelayLiveness } from "applesauce-relay";
import localforage from "localforage";

// Create a liveness tracker with persistent storage
const liveness = new RelayLiveness({
  storage: localforage.createInstance({ name: "liveness" }),
});

// Load previously saved relay states
await liveness.load();

// Connect to your relay pool to automatically track relay health
liveness.connectToPool(pool);
```

### Configuration Options

```typescript
const liveness = new RelayLiveness({
  // Maximum failures before marking relay as dead (default: 5)
  maxFailuresBeforeDead: 5,

  // Base delay for backoff in milliseconds (default: 30 seconds)
  backoffBaseDelay: 30 * 1000,

  // Maximum backoff delay in milliseconds (default: 5 minutes)
  backoffMaxDelay: 5 * 60 * 1000,

  // Optional storage adapter for persistence
  storage: localforage.createInstance({ name: "liveness" }),
});
```

## Observables

The liveness tracker provides several observables to monitor recent relay connection states:

```typescript
// Subscribe to different relay states
liveness.online$.subscribe((relays) => {
  console.log("Online relays:", relays);
});

liveness.offline$.subscribe((relays) => {
  console.log("Offline relays:", relays);
});

liveness.dead$.subscribe((relays) => {
  console.log("Dead relays:", relays);
});

// Most useful: available vs blacklisted relays
liveness.healthy$.subscribe((relays) => {
  console.log("Available relays:", relays);
});

liveness.unhealthy$.subscribe((relays) => {
  console.log("Blacklisted relays:", relays);
});
```

## Filtering Relays

### Using RxJS Operators

The easiest way to filter out blacklisted relays is using the provided RxJS operators

:::info
All RxJS operators will trigger updates when relays come back online or go offline. this allows you to dynamically filter relays without needing to subscribe to the liveness tracker observables.
:::

#### Using the `ignoreUnhealthyRelays` operator

```typescript
import { ignoreUnhealthyRelays } from "applesauce-relay/operators";

const relayList$ = of(["wss://relay.example.com", "wss://relay.example.com/2"]);

// Filter unhealthy relays from a simple array
relayList$.pipe(ignoreUnhealthyRelays(liveness)).subscribe((availableRelays) => {
  // Only available relays remain
});
```

### Using the `ignoreUnhealthyRelaysOnPointers` operator

The `ignoreUnhealthyRelaysOnPointers` operator is useful when you have a list of nip-19 pointers with relays and you want to filter out unhealthy relays.

```typescript
import { ignoreUnhealthyRelaysOnPointers } from "applesauce-relay/operators";

// Filter unhealthy relays from user mailboxes
contacts$
  .pipe(
    includeMailboxes(eventStore),
    ignoreUnhealthyRelaysOnPointers(liveness), // Removes unhealthy relays
  )
  .subscribe((users) => {
    // users now have unhealthy relays filtered out
  });
```

#### Using the `ignoreUnhealthyMailboxes` operator

The `ignoreUnhealthyMailboxes` operator is useful when you have a users mailboxes and you want to filter out unhealthy relays.

```typescript
import { ignoreUnhealthyMailboxes } from "applesauce-relay/operators";

const mailboxes$ = eventStore.mailboxes("pubkey...");

// Filter unhealthy relays from user mailboxes
mailboxes$
  .pipe(
    ignoreUnhealthyMailboxes(liveness), // Removes unhealthy relays
  )
  .subscribe((mailboxes) => {
    // mailboxes now have unhealthy relays filtered out
  });
```

### Manual Filtering

You can also manually filter relays using the `filter()` method:

```typescript
// Get current blacklisted relays
const healthy = liveness.filter(allRelays);

// Filter them out manually
const availableRelays = allRelays.filter((relay) => !blacklistedRelays.includes(relay));
```

## Manual Management

### Reviving Blacklisted Relays

If a relay was blacklisted but you want to try it again:

```typescript
// Manually revive a blacklisted relay
liveness.revive("wss://relay.example.com");
```

### Checking Individual Relay State

```typescript
// Get current state for a specific relay (synchronous)
const state = liveness.getState("wss://relay.example.com");
console.log({
  state: state?.state, // "online", "offline", or "dead"
  failureCount: state?.failureCount,
  lastFailureTime: state?.lastFailureTime,
  backoffUntil: state?.backoffUntil,
});

// Subscribe to state changes for a specific relay (reactive)
liveness.state("wss://relay.example.com").subscribe((state) => {
  console.log("Relay state changed:", state);
});
```

## Best Practices

1. **Always use filtering**: Filter all relays through the liveness tracker to avoid connecting to dead relays
2. **Persist state**: Use storage to remember relay blacklist status across sessions
3. **Connect to pool**: Let the tracker automatically monitor your relay pool
4. **Monitor observables**: Subscribe to connection state observables to update your UI
5. **Manual revival**: Provide users a way to manually revive blacklisted relays they know are working

## Using with outbox model

The liveness tracker works particularly well with relay selection algorithms (outbox model):

```typescript
// 1. Load user contacts
const contacts$ = pubkey$.pipe(switchMap((pubkey) => eventStore.contacts(pubkey)));

// 2. Load their mailboxes and filter unhealthy relays
const availableContacts$ = contacts$.pipe(
  // Load the contacts mailboxes
  includeMailboxes(eventStore),
  // Filter out unhealthy relays
  ignoreUnhealthyRelaysOnPointers(liveness),
);

// 3. Select optimal relays from available ones only
const selection$ = availableContacts$.pipe(
  map((users) => selectOptimalRelays(users, { maxConnections, maxRelaysPerUser })),
);
```
