# Relay Pool

The `RelayPool` class in `applesauce-relay` provides a powerful way to manage multiple relay connections, allowing you to interact with multiple relays as if they were a single entity.

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

The `publish` method is a wrapper around the `event` method that returns a `Promise` and automatically handles reconnecting and retrying:

```typescript
// Publish with retries (defaults to 3 retries)
const responses = await pool.publish(relays, event);
for (const response of responses) {
  console.log(`Published to ${response.from}:`, response.ok, response.message);
}
```

### Request Method

The `request` method allows you to make one-off requests with automatic retries:

```typescript
// Request with automatic retries
pool
  .request(
    relays,
    {
      kinds: [1],
      authors: ["pubkey1", "pubkey2"],
      limit: 50,
    },
    {
      retries: 2,
      timeout: 5000, // 5 seconds
    },
  )
  .subscribe({
    next: (event) => console.log("Received event:", event.id),
    complete: () => console.log("Request complete"),
  });
```

### Subscription Method

The `subscription` method creates persistent subscriptions that automatically reconnect:

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
      retries: Infinity, // retry forever
    },
  )
  .subscribe({
    next: (response) => {
      if (response === "EOSE") {
        console.log("End of stored events");
      } else {
        console.log("Subscription update:", response);
      }
    },
  });

// Later, you can unsubscribe
subscription.unsubscribe();
```

All of these methods accept the same parameters as their counterparts in the `Relay` class, making it easy to transition between working with individual relays and relay pools.

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

The RelayGroup intelligently merges responses from multiple relays, emitting EOSE only when all relays have sent their EOSE signals.

## Observable Properties

The RelayPool provides observables for tracking relays and groups:

```typescript
// Subscribe to changes in the relays map
pool.relays$.subscribe((relaysMap) => {
  console.log("Relays updated:", Array.from(relaysMap.keys()));
});

// Subscribe to changes in the relay groups map
pool.groups$.subscribe((groupsMap) => {
  console.log("Groups updated:", Array.from(groupsMap.keys()));
});
```
