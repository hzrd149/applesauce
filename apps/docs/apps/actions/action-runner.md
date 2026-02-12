---
description: Central orchestrator for running actions that combines EventStore, EventFactory, and publishing for unified action execution
---

# Action Hub

The [ActionRunner](https://applesauce.hzrd149.com/typedoc/classes/applesauce-actions.ActionRunner.html) class is the central orchestrator for running actions in your Nostr application. It combines an event store, event factory, and optional publish method into a unified interface, making it simple to execute actions that read from your local event store and publish new events to the Nostr network.

## Creating an Action Hub

### Basic Setup

To create an ActionRunner, you need an event store and event factory. Optionally, you can provide a publish method to automatically handle event publishing.

```ts
import { ActionRunner } from "applesauce-actions";
import { NostrEvent } from "applesauce-core/helpers/event";

// Create a basic ActionRunner without automatic publishing
const hub = new ActionRunner(eventStore, eventFactory);

// Or create one with automatic publishing
const publish = async (event: NostrEvent, relays?: string[]) => {
  console.log("Publishing event:", event.kind);
  await relayPool.publish(relays || defaultRelays, event);
};

const hub = new ActionRunner(eventStore, eventFactory, publish);
```

### With Custom Publishing Logic

You can provide sophisticated publishing logic when creating your ActionRunner:

```ts
const publish = async (event: NostrEvent, relays?: string[]) => {
  // Log the event
  console.log("Publishing", event);

  // Publish to relays (use provided relays or fallback to defaults)
  await app.relayPool.publish(relays || app.defaultRelays, event);

  // Save to local backup
  await localBackup.save(event);

  // Notify UI of new event
  eventBus.emit("eventPublished", event);
};

const hub = new ActionRunner(eventStore, eventFactory, publish);
```

:::info
For performance reasons, it's recommended to create only one `ActionRunner` instance for your entire application and reuse it across all action executions.
:::

## Configuration Options

### Save to Store

By default, the ActionRunner will automatically save all events created by actions to your event store. You can disable this behavior:

```ts
const hub = new ActionRunner(eventStore, eventFactory, publish);
hub.saveToStore = false; // Disable automatic saving to event store
```

## Running Actions

The ActionRunner provides two primary methods for executing actions: `.run()` for fire-and-forget execution with automatic publishing, and `.exec()` for fine-grained control over event handling.

### Using `.run()` - Automatic Publishing

The [ActionRunner.run](https://applesauce.hzrd149.com/typedoc/classes/applesauce-actions.ActionRunner.html#run) method executes an action and automatically publishes all generated events using the publish method provided during ActionRunner creation.

Actions can specify which relays to publish to by passing a `relays` array as the second argument to the `publish` function in their context. If no relays are specified, the publish method will use its default behavior (often determined by the user's outboxes or default relays).

:::warning
`ActionRunner.run()` will throw an error if no `publish` method was provided when creating the ActionRunner.
:::

```ts
import { FollowUser, NewContacts, UnfollowUser } from "applesauce-actions/actions";

// Create a new contact list (throws if one already exists)
try {
  await hub.run(NewContacts);
  console.log("Contact list created successfully");
} catch (err) {
  console.error("Failed to create contact list:", err.message);
}

// Follow a user - events are automatically published
await hub.run(FollowUser, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");

// Unfollow a user
await hub.run(UnfollowUser, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");
```

### Using `.exec()` - Manual Event Handling

The [ActionRunner.exec](https://applesauce.hzrd149.com/typedoc/classes/applesauce-actions.ActionRunner.html#exec) method executes an action and returns an RxJS Observable of events, giving you complete control over how events are handled and published.

#### Using RxJS forEach for Simple Cases

The RxJS [Observable.forEach](https://rxjs.dev/api/index/class/Observable#foreach) method provides a clean way to handle all events with a single function:

```ts
import { FollowUser, NewContacts } from "applesauce-actions/actions";

// Custom publishing logic for this specific action
const customPublish = async (event: NostrEvent) => {
  // Publish to specific relays
  await relayPool.publish(["wss://relay.damus.io", "wss://nos.lol"], event);

  // Save to local database with custom metadata
  await localDatabase.saveContactListUpdate(event, { source: "user_action" });
};

// Execute action and handle each event
await hub.exec(NewContacts).forEach(customPublish);

// Follow user with custom handling
await hub.exec(FollowUser, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d").forEach(customPublish);
```

#### Using RxJS Subscriptions for Advanced Control

For more complex scenarios, you can manually subscribe to the observable:

```ts
import { tap, catchError, finalize } from "rxjs";
import { EMPTY } from "rxjs";

const subscription = hub
  .exec(FollowUser, userPubkey)
  .pipe(
    tap((event) => console.log("Generated event:", event.kind)),
    catchError((err) => {
      console.error("Action failed:", err);
      return EMPTY; // Handle errors gracefully
    }),
    finalize(() => console.log("Action completed")),
  )
  .subscribe({
    next: async (event) => {
      try {
        await customPublish(event);
        console.log("Event published successfully");
      } catch (err) {
        console.error("Failed to publish event:", err);
      }
    },
    complete: () => {
      console.log("All events processed");
      subscription.unsubscribe();
    },
    error: (err) => {
      console.error("Observable error:", err);
      subscription.unsubscribe();
    },
  });
```

#### Collecting Events Before Publishing

You can collect all events from an action before publishing them:

```ts
import { toArray, lastValueFrom } from "rxjs";

// Collect all events into an array
const events = await lastValueFrom(hub.exec(NewContacts).pipe(toArray()));

console.log(`Action generated ${events.length} events`);

// Publish them in a specific order or with delays
for (const event of events) {
  await relayPool.publish(defaultRelays, event);
  await delay(100); // Small delay between publishes
}
```

## Error Handling

### Action Validation Errors

Actions will throw errors for various validation failures:

```ts
try {
  await hub.run(NewContacts);
} catch (err) {
  if (err.message.includes("contact list already exists")) {
    console.log("User already has a contact list");
  } else {
    console.error("Unexpected error:", err);
  }
}
```

### Publishing Errors

When using `.exec()`, you can handle publishing errors independently:

```ts
await hub.exec(FollowUser, userPubkey).forEach(async (event) => {
  try {
    await relayPool.publish(defaultRelays, event);
  } catch (publishError) {
    console.error("Failed to publish event:", publishError);
    // Could retry, save for later, or notify user
    await saveForRetry(event);
  }
});
```

## Integration

### With RelayPool

ActionRunner publishes events through the RelayPool. The typical pattern is to bind the pool's publish method:

```ts
import { RelayPool } from "applesauce-relay";
import { ActionRunner } from "applesauce-actions";

const pool = new RelayPool();
const defaultRelays = ["wss://relay.damus.io", "wss://nos.lol"];

const publish = async (event, relays) => {
  await pool.publish(relays || defaultRelays, event);
};

const actions = new ActionRunner(eventStore, factory, publish);
```

Actions determine which relays to use based on NIP-65 (outbox/inbox model). The publish function receives the relay list from the action.

### With EventStore

ActionRunner integrates deeply with EventStore for both reading and writing:

```ts
import { EventStore } from "applesauce-core";

const eventStore = new EventStore();
const actions = new ActionRunner(eventStore, factory, publish);

// Actions read from the event store
await actions.run(FollowUser, pubkey);
// The FollowUser action checks if the user is already followed

// Events are automatically saved to the store (when saveToStore = true)
// After publishing completes, the event is added to eventStore
```

### With AccountManager

```ts
const factory = new EventFactory({ signer: manager.signer });
const actions = new ActionRunner(eventStore, factory, publish);

manager.setActive(account1);
await actions.run(CreateProfile, { name: "Alice" });
```

### With Event Loaders

```ts
createEventLoaderForStore(eventStore, pool, {
  lookupRelays: ["wss://purplepag.es/"],
});

await actions.run(CreateComment, parentEvent, "Great post!");
// CreateComment loads parent author's mailboxes automatically
```

## Best Practices

### Single ActionRunner Instance

```ts
// app.ts
export const actions = new ActionRunner(eventStore, factory, publish);
```

### Relay Selection Strategy

Let actions determine relay selection based on NIP-65:

```ts
await actions.run(SendLegacyMessage, recipientPubkey, "Hello"); // Uses recipient's inboxes
await actions.run(UpdateProfile, { name: "Alice" }); // Uses your outboxes
```

### Error Handling

```ts
try {
  await actions.run(FollowUser, pubkey);
} catch (err) {
  if (err.message.includes("already following")) {
    console.log("Already following");
  } else {
    showErrorToUser(err.message);
  }
}
```

### Bulk Operations

```ts
actions.saveToStore = false; // Disable auto-save

const events = await lastValueFrom(actions.exec(BulkFollow, users).pipe(toArray()));
for (const event of events) {
  try {
    await pool.publish(relays, event);
    eventStore.add(event);
  } catch (err) {
    console.error("Failed:", err);
  }
}

actions.saveToStore = true; // Re-enable
```
