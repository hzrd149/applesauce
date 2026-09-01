---
description: RelayPool class for managing multiple relay connections with subscriptions and event publishing
---

# Relay Pool

The `RelayPool` class in `applesauce-relay` manages multiple relay connections as one event source. Its high-level request and subscription methods emit deduplicated events and report total active-cohort failure as `RelayGroupError`.

## Features

- Connect to multiple relays
- Create and manage groups of relays
- Send requests and events to multiple relays simultaneously
- Maintain a blacklist of relays to avoid

## Relay Management

The RelayPool provides methods to create and manage relay connections:

```typescript
// Get or create a relay connection
const relay = pool.relay("wss://relay.example.com");

// Create a group of relays
const group = pool.group(["wss://relay1.example.com", "wss://relay2.example.com"]);
```

## Making Requests

The RelayPool provides several methods to interact with relays. These methods mirror those found in the `Relay` class, allowing you to use familiar patterns while working with multiple relays simultaneously.

### REQ Method

The `req` method sends a subscription request to multiple relays:

```typescript
// Send a REQ to multiple relays
pool
  .req(relays, {
    kinds: [1],
    limit: 10,
  })
  .subscribe({
    next: (response) => {
      if (response === "EOSE") {
        console.log("End of stored events from all relays");
      } else {
        console.log("Event", response);
      }
    },
    error: (error) => {
      console.error("Subscription error:", error);
    },
  });
```

**Note:** The `req` method does not deduplicate events by default. If you need deduplication, use the `request` or `subscription` methods instead, which automatically deduplicate events using an event store.

### Event Method

The `event` method sends an `EVENT` message to multiple relays and returns an observable of the responses from each relay.

```typescript
const event = {
  kind: 1,
  content: "Hello from RelayPool!",
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  // ... other required fields
};

// Subscribe to a stream of responses
pool.event(relays, event).subscribe({
  next: (response) => {
    console.log(`Published to ${response.from}:`, response.ok);
    if (!response.ok) console.log(`Error message: ${response.message}`);
  },
  complete: () => {
    console.log("Publishing complete");
  },
});
```

### Publish Method

The `publish` method is a wrapper around the `event` method that returns a `Promise<PublishResponse[]>` and automatically handles retrying:

```typescript
// Publish with retries (defaults to 3 retries)
const responses = await pool.publish(relays, event);
for (const response of responses) {
  console.log(`Published to ${response.from}:`, response.ok, response.message);
}
```

### Request Method

The `request` method allows you to make one-off requests with automatic retries for connection errors:

```typescript
pool.request(relays, { kinds: [1], limit: 50 }, { timeout: 5000 }).subscribe({
  next: (event) => console.log(event.id),
  error(error) {
    if (error instanceof RelayGroupError) {
      for (const [url, outcome] of Object.entries(error.outcomes))
        console.error(url, outcome.error);
    }
  },
  complete: () => console.log("Request complete"),
});
```

`request()` has one 30-second whole-Observable timeout by default. Events, EOSE, retries, and reconnections do not reset it. A request with no active relays completes empty; one EOSE plus any failures is also a successful request.

### Subscription Method

The `subscription` method creates persistent subscriptions that retry connection errors and can resubscribe after clean relay `CLOSED` messages:

```typescript
// Create persistent subscription
const subscription = pool
  .subscription(
    relays,
    {
      kinds: [1, 7],
      "#t": ["nostr"],
    },
    {
      id: "custom-sub-id", // optional custom subscription ID
      reconnect: Infinity, // retry connection errors forever
      resubscribe: true, // resubscribe after clean relay CLOSED messages
      timeout: false, // indefinite by default; use a number for a total lifetime
    },
  )
  .subscribe({
    next: (event) => console.log("Subscription update:", event),
  });

// Later, you can unsubscribe
subscription.unsubscribe();
```

All of these methods accept the same parameters as their counterparts in the `Relay` class, making it easy to transition between working with individual relays and relay pools.

### Subscription Map Method

The `subscriptionMap` method allows you to subscribe to different filters on different relays:

```typescript
import { createFilterMap } from "applesauce-core/helpers";

// Create a map of relay URLs to filters
const filterMap = {
  "wss://relay1.example.com": { kinds: [1], authors: ["pubkey1"] },
  "wss://relay2.example.com": { kinds: [1], authors: ["pubkey2"] },
};

pool.subscriptionMap(filterMap).subscribe({
  next: (event) => console.log("Event:", event),
});
```

### Outbox Subscription Method

The `outboxSubscription` method is designed for the outbox model (NIP-65), allowing you to subscribe to events from users using their designated outbox relays:

```typescript
import { createOutboxMap } from "applesauce-core/helpers/relay-selection";

// Create an outbox map from user profiles with relay preferences
const outboxMap = createOutboxMap(usersWithRelays);

pool
  .outboxSubscription(
    outboxMap,
    { kinds: [1], since: unixNow() - 3600 }, // Filter without authors (added automatically)
  )
  .subscribe({
    next: (event) => console.log("Event from outbox:", event),
  });
```

### Count Method

The `count` method sends a COUNT request to multiple relays and returns counts from each:

```typescript
pool.count(relays, { kinds: [1], authors: ["pubkey"] }).subscribe({
  next: (counts) => {
    // counts is a Record<string, CountResponse>
    Object.entries(counts).forEach(([relay, response]) => {
      console.log(`${relay}: ${response.count} events`);
    });
  },
});
```

Pool and Group forward the caller ID and the same auth, `reconnect`, `retries`, and whole-request `timeout` options as `Relay.count()`. They return an Observable record keyed by relay URL.

#### Integration

```typescript
import { estimateHllCardinality, mergeHllRegisters } from "applesauce-relay";

pool.count(relays, filter, "union").subscribe((responses) => {
  const sketches = Object.values(responses).flatMap((r) => (r.hll ? [r.hll] : []));
  if (sketches.length) {
    const merged = mergeHllRegisters(sketches);
    console.log(estimateHllCardinality(merged));
  }
});
```

#### Best Practices

- Never sum counts from overlapping relays.
- Relays without compatible HLL sketches cannot contribute to the HLL union.
- Group and Pool remain all-or-nothing in this phase: one relay error fails the record, and partial records or automatic aggregation are deferred to Phase 23.

### Sync Method

The `sync` method performs bidirectional Negentropy synchronization (NIP-77) with relays:

```typescript
pool
  .sync(
    relays,
    eventStore, // or array of events
    { kinds: [1], authors: ["pubkey"] },
    "down", // optional: "up", "down", or "both" (default)
  )
  .subscribe({
    next: (event) => console.log("Synced event:", event),
    complete: () => console.log("Sync complete"),
  });
```

## Relay Groups

The `RelayGroup` class is used internally by RelayPool to manage collections of relays. You can access relay groups directly through the pool:

```typescript
// Create a group of relays
const group = pool.group(["wss://relay1.example.com", "wss://relay2.example.com"]);

// Make requests to the group
group.req({ kinds: [1] }).subscribe((response) => console.log(response));

// Send events to the group
group.event(event).subscribe((response) => console.log(response));

// Use other group methods
group.publish(event).subscribe((response) => console.log(response));
group.request({ kinds: [1] }).subscribe((event) => console.log(event));
group.subscription({ kinds: [1] }).subscribe((response) => console.log(response));
```

High-level Group and Pool methods preserve the same `RelayGroupError` instance. Outcome keys are normalized relay URLs and causes retain identity; raw `req()` keeps exposing lifecycle messages instead of this aggregate error contract.

## Integration

Dynamic `subscriptionMap()` and `outboxSubscription()` replace the active relay cohort as their maps change. An empty dynamic subscription stays open for future relays, while an empty finite request completes immediately.

Every enabled whole-operation timeout shares the call's authentication gate. Its remaining budget pauses while any relay authenticates and resumes only after overlapping auth phases all finish.

## Best Practices

- Handle `RelayGroupError` at the returned Observable's `error` callback.
- Use `outcomes` for normalized URL lookup and native `errors` for aggregate tooling.
- Leave subscription timeout omitted or `false` for intentionally long-lived streams.
- Use a numeric subscription timeout only when the whole subscription needs a fixed lifetime.

## Observable Properties

The RelayPool provides observables for tracking relays:

```typescript
// Subscribe to changes in the relays map
pool.relays$.subscribe((relaysMap) => {
  console.log("Relays updated:", Array.from(relaysMap.keys()));
});

// Listen for relay additions
pool.add$.subscribe((relay) => {
  console.log("Relay added:", relay.url);
});

// Listen for relay removals
pool.remove$.subscribe((relay) => {
  console.log("Relay removed:", relay.url);
});
```
