# 7. Publishing Events

The final step in building a Nostr app is publishing your events to relays so other users can see them. The `RelayPool` provides methods for publishing events and handling the responses from relays.

## What is Publishing?

Publishing is the process of:

- **Sending signed events to relays** - Broadcasting your content to the network
- **Handling relay responses** - Success, errors, or rejection messages
- **Managing multiple relays** - Publishing to several relays for redundancy
- **Providing user feedback** - Showing publication status to users

## Basic Event Publishing

Here's how to publish a single event to a relay using the `pool.relay` method to select a single relay and the `publish` method to publish the event.

```typescript
const pool = new RelayPool();

const event: NostrEvent = {
  // ...signed nostr event
};

try {
  const response = await pool.relay("wss://relay.damus.io").publish(event);
  if (response.ok) {
    console.log(`Event published successfully to ${response.from}`);
  } else {
    console.log(`Failed to publish event to ${response.from}: ${response.message}`);
  }
} catch (error) {
  console.error("Error publishing event:", error);
}
```

:::info
The `publish` method now returns a `Promise<PublishResponse>` directly, so you can use `await` or `.then()` instead of subscribing to an Observable.
:::

## Publishing to Multiple Relays

For better reach and redundancy the `pool.publish` method can be used with multiple relays.

```typescript
const relays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];
const event: NostrEvent = {
  // ...signed nostr event
};

try {
  const responses = await pool.publish(relays, event);
  responses.forEach((response) => {
    if (response.ok) {
      console.log(`Event published successfully to ${response.from}`);
    } else {
      console.log(`Failed to publish event to ${response.from}: ${response.message}`);
    }
  });
} catch (error) {
  console.error("Error publishing to relays:", error);
}
```

## Adding Events to the EventStore

Once the event is published to relays, its good to add it to the event store so your UI can see it without needing to load it from the relay again.

```typescript
try {
  const response = await pool.relay("wss://relay.damus.io").publish(event);
  if (response.ok) {
    eventStore.add(event);
  }
} catch (error) {
  console.error("Error publishing event:", error);
}
```

## Using with .then() instead of async/await

If you prefer using `.then()` instead of async/await:

```typescript
pool
  .relay("wss://relay.damus.io")
  .publish(event)
  .then((response) => {
    if (response.ok) {
      console.log(`Event published successfully to ${response.from}`);
      eventStore.add(event);
    } else {
      console.log(`Failed to publish event to ${response.from}: ${response.message}`);
    }
  })
  .catch((error) => {
    console.error("Error publishing event:", error);
  });
```

## Key Concepts

- **Publishing sends events to relays** so others can see them
- **Handle relay responses** - success, errors, or rejections
- **Publish to multiple relays** for better reach and redundancy
- **Add published events to EventStore** to see them in your UI
- **Provide user feedback** about publishing status
- **Handle errors gracefully** with try/catch or .catch()

## Best Practices

1. **Always publish to multiple relays** for redundancy
2. **Handle rate limiting** with delays and retries
3. **Provide clear user feedback** about publishing status
4. **Add published events to EventStore** after successful publish
5. **Don't spam relays** - use reasonable delays between publishes
6. **Use try/catch blocks** to handle errors gracefully
