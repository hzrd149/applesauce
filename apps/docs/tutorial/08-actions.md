# 8. Running Actions with ActionHub

The `ActionHub` is the central orchestrator for running actions in your Nostr application. It combines your EventStore, EventFactory, and publishing logic into a unified interface, making it simple to execute complex actions that read from your local data and publish new events to the network.

## What is ActionHub?

ActionHub is a class that:

- **Executes pre-built actions** - Like following users, creating contact lists, etc.
- **Handles event creation and publishing** - Automatically creates, signs, and publishes events
- **Provides error handling** - Gracefully handles validation and publishing errors
- **Offers flexible execution modes** - Automatic publishing or manual control

## Setting up ActionHub

### Basic Setup

To create an ActionHub, you need your `EventStore` and `EventFactory` instances:

```typescript
import { ActionHub } from "applesauce-actions";
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core";
import { ExtensionSigner } from "applesauce-signers";

// Your existing instances
const eventStore = new EventStore();
const signer = new ExtensionSigner();
const eventFactory = new EventFactory({ signer });

// Create ActionHub without automatic publishing
const actionHub = new ActionHub(eventStore, eventFactory);
```

### With Custom Publishing Logic

For most applications, you'll want to provide a publish method that handles how events are sent to relays:

```typescript
import { RelayPool } from "applesauce-relay";
import { NostrEvent } from "applesauce-core/helpers/event";

const pool = new RelayPool();
const defaultRelays = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.nostr.band"];

// Create a custom publish function
function publish(event: NostrEvent) {
  return pool.publish(event, defaultRelays);
}

// Create ActionHub with automatic publishing
const actionHub = new ActionHub(eventStore, eventFactory, publish);
```

## Running Actions

### Using `hub.run()` - Automatic Publishing

The `hub.run()` method executes an action and automatically publishes all generated events:

```typescript
import { FollowUser, UnfollowUser, NewContacts } from "applesauce-actions/actions";

// Create a new contact list (if one doesn't exist)
try {
  await actionHub.run(NewContacts);
  console.log("Contact list created successfully");
} catch (error) {
  if (error.message.includes("contact list already exists")) {
    console.log("User already has a contact list");
  } else {
    console.error("Failed to create contact list:", error);
  }
}

// Follow a user - events are automatically published
const userToFollow = "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
const relayHint = "wss://relay.damus.io";

try {
  await actionHub.run(FollowUser, userToFollow, relayHint);
  console.log("Successfully followed user");
} catch (error) {
  console.error("Failed to follow user:", error);
}

// Unfollow a user
try {
  await actionHub.run(UnfollowUser, userToFollow);
  console.log("Successfully unfollowed user");
} catch (error) {
  console.error("Failed to unfollow user:", error);
}
```

### Using `hub.exec()` for Manual Control

For more control over event handling, you can use `hub.exec()` which returns an observable:

```typescript
import { tap, catchError } from "rxjs/operators";
import { EMPTY } from "rxjs";

// Execute action with manual event handling
actionHub.exec(FollowUser, userPubkey, relayHint).subscribe({
  next: async (event) => {
    try {
      // Custom publishing logic for this specific action
      await customPublish(event);
      console.log("Event published successfully");
    } catch (error) {
      console.error("Failed to publish event:", error);
    }
  },
  error: (error) => {
    console.error("Action failed:", error);
  },
  complete: () => {
    console.log("Action completed");
  },
});
```

## Available Actions

There are a lot of pre-built [actions](https://hzrd149.github.io/applesauce/typedoc/modules/applesauce-actions.Actions.html), but here are a few common ones that are worth mentioning.

### Contact List Actions

```typescript
import { NewContacts, FollowUser, UnfollowUser } from "applesauce-actions/actions";

// Create a new contact list
await actionHub.run(NewContacts);

// Follow a user
await actionHub.run(FollowUser, pubkey, relayHint);

// Unfollow a user
await actionHub.run(UnfollowUser, pubkey);
```

### Profile Actions

```typescript
import { UpdateProfile } from "applesauce-actions/actions";

// Update your profile
await actionHub.run(UpdateProfile, {
  name: "Alice",
  about: "Bitcoin developer",
  picture: "https://example.com/alice.jpg",
  website: "https://alice.dev",
});
```

## Error Handling

Actions can fail for various reasons. Always handle errors appropriately:

```typescript
async function safeFollowUser(pubkey, relayHint) {
  try {
    await actionHub.run(FollowUser, pubkey, relayHint);
    return { success: true };
  } catch (error) {
    console.error("Follow action failed:", error);

    if (error.message.includes("contact list")) {
      // Try to create contact list first
      try {
        await actionHub.run(NewContacts);
        await actionHub.run(FollowUser, pubkey, relayHint);
        return { success: true };
      } catch (retryError) {
        return { success: false, error: "Failed to create contact list" };
      }
    }

    if (error.message.includes("signer")) {
      return { success: false, error: "Please connect your Nostr extension" };
    }

    return { success: false, error: error.message };
  }
}

// Usage
const result = await safeFollowUser(pubkey, relayHint);
if (result.success) {
  console.log("User followed successfully");
} else {
  console.error("Failed to follow user:", result.error);
}
```

## Configuration Options

### Disable Automatic EventStore Saving

By default, `ActionHub` saves all generated events to your `EventStore`. You can disable this:

```typescript
const actionHub = new ActionHub(eventStore, eventFactory, publish);
actionHub.saveToStore = false; // Disable automatic saving

// Now events are only published, not saved to local store
await actionHub.run(FollowUser, pubkey, relayHint);
```

### Conditional Saving

You might want to save events only after successful publishing:

```typescript
const actionHub = new ActionHub(eventStore, eventFactory);
actionHub.saveToStore = false; // Disable automatic saving

// Manual event handling with conditional saving
await actionHub.exec(FollowUser, pubkey, relayHint).forEach(async (event) => {
  try {
    // Publish first
    await publish(event);

    // Save to store only after successful publish
    eventStore.add(event);
    console.log("Event published and saved");
  } catch (error) {
    console.error("Failed to publish, not saving to store:", error);
  }
});
```

## Best Practices

### 1. Single ActionHub Instance

Create one ActionHub instance for your entire application:

```typescript
// app.ts
export const actionHub = new ActionHub(eventStore, eventFactory, publish);

// other-file.ts
import { actionHub } from "./app";
await actionHub.run(FollowUser, pubkey);
```

### 2. Error Handling

Actions can throw errors so many sure to handle them gracefully.

```typescript
try {
  await actionHub.run(FollowUser, pubkey);
} catch (error) {
  console.error("Failed to follow user:", error);
}
```

## Key Concepts

- **ActionHub orchestrates** EventStore, EventFactory, and publishing
- **Actions are pre-built** functions for common Nostr operations
- **`hub.run()` provides automatic** event creation and publishing
- **`hub.exec()` gives manual control** over event handling
- **Error handling is crucial** for good user experience
- **Single instance per app** is recommended for consistency

## Next Steps

You now know enough to build a Nostr application! Checkout some some of the examples apps in the [examples](https://hzrd149.github.io/applesauce/examples) directory to see whats possible.
