# 1. Introduction to EventStore

The `EventStore` is the heart of every applesauce application. Its a reactive in-memory database specifically designed for Nostr events. Instead of constantly fetching data from relays, your UI components subscribe to the EventStore and automatically update when new events arrive.

## What is the EventStore?

The EventStore is a reactive database that:

- **Stores events in memory** for fast access
- **Deduplicates events** automatically
- **Handles replaceable events** (like profiles) by keeping only the latest version
- **Notifies subscribers** when relevant events are added, updated, or removed
- **Works with RxJS observables** for reactive programming

## Creating an EventStore

Creating an EventStore is simple:

```typescript
import { EventStore } from "applesauce-core";

// Create a single event store for your entire app
const eventStore = new EventStore();
```

> 💡 **Best Practice**: Create only one EventStore instance for your entire application and share it across components.

## Adding Events

You can add events to the store using the `add()` method:

```typescript
const event = {
  content: "These numbers are so kind.",
  created_at: 1745847253,
  id: "621233a1ad1b91620f0b4a308c2113243a98925909cdb7b26284cbb4d835a18c",
  kind: 1,
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  sig: "eb8f30f7c44d031bfe315d476165f5cf29c21f1eaf07128f5a673cdb3b69ebf7902dacc06987f8d764b17225aefecdbc91992165e03372e40f57639a41203a1c",
  tags: [],
};

// Add the event to the store
eventStore.add(event);
```

The EventStore automatically:

- **Deduplicates** - Won't add the same event twice
- **Replaces** - Updates replaceable events (kind 0 profiles, kind 3 contacts, etc.) with newer versions
- **Notifies** - Triggers updates for any components subscribed to this event

## Checking for Events

You can check if events exist in the store:

```typescript
// Check if a specific event exists
const hasEvent = eventStore.hasEvent("abc123...");

// Check if a user has a profile
const hasProfile = eventStore.hasReplaceable(0, "userPubkey");

// Get an event directly
const event = eventStore.getEvent("abc123...");

// Get a user's latest profile
const profile = eventStore.getReplaceable(0, "userPubkey");
```

## Subscribing to Events

The real power of the EventStore comes from its reactive subscriptions. Here are the main subscription types:

### Single Event Subscription

```typescript
// Subscribe to a specific event
eventStore.event("abc123...").subscribe((event) => {
  if (event) {
    console.log("Event found:", event);
  } else {
    console.log("Event not in store or was deleted");
  }
});
```

### Replaceable Event Subscription

```typescript
// Subscribe to a user's profile (kind 0)
eventStore.replaceable(0, "userPubkey").subscribe((profile) => {
  if (profile) {
    console.log("User profile:", profile);
  }
});
```

### Stream Subscription

```typescript
// Subscribe to all text notes as they're added
eventStore.stream({ kinds: [1] }).subscribe((event) => {
  console.log("New text note:", event);
});
```

### Timeline Subscription

```typescript
// Subscribe to a sorted timeline of text notes
eventStore.timeline({ kinds: [1] }).subscribe((events) => {
  console.log(`Timeline updated with ${events.length} notes`);
  // events is a sorted array (newest first)
});
```

## A Simple Example

Let's see how this works in practice:

```typescript
import { EventStore } from "applesauce-core";

// Create the store
const eventStore = new EventStore();

// Subscribe to all text notes
eventStore.timeline({ kinds: [1] }).subscribe((timeline) => {
  console.log(`Timeline has ${timeline.length} notes`);
});

// Add some events
eventStore.add({
  content: 'I just wish LLMs would stop saying their solutions are "comprehensive" or "powerful"',
  created_at: 1749596768,
  id: "77941979d4c04283fd9b2f0a280749248cbd41babe3a0731c1597a6d54ae7874",
  kind: 1,
  pubkey: "97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322",
  sig: "a0884549f09ef805d3ffa917c3d9e189882295f1b819c038e5d28ea1a668f4455f66ada40749dbdb6dfd48c323f507889330a2a4742b0cb66d8997afb31ff47e",
  tags: [["client", "Coracle", "31990:97c70a44366a6535c145b333f973ea86dfdc2d7a99da618c40c64705ad98e322:1685968093690"]],
});

eventStore.add({
  content: "These numbers are so kind.",
  created_at: 1745847253,
  id: "621233a1ad1b91620f0b4a308c2113243a98925909cdb7b26284cbb4d835a18c",
  kind: 1,
  pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
  sig: "eb8f30f7c44d031bfe315d476165f5cf29c21f1eaf07128f5a673cdb3b69ebf7902dacc06987f8d764b17225aefecdbc91992165e03372e40f57639a41203a1c",
  tags: [],
});

// The timeline subscription will fire twice:
// First: "Timeline has 1 notes"
// Then: "Timeline has 2 notes"
```

## Key Concepts

- **Reactive**: Changes to the EventStore automatically update your UI
- **In-memory**: Events are stored in RAM for fast access (not persisted)
- **Deduplication**: The same event won't be added twice
- **Replaceable events**: Newer versions replace older ones automatically
- **Filters**: Use Nostr filters to subscribe to specific types of events

## Why Use EventStore?

Without EventStore, you'd need to:

- Manually track which events you've already received
- Handle event deduplication yourself
- Manually update UI components when new events arrive
- Deal with replaceable event logic

With EventStore, all of this is handled automatically, letting you focus on building your application logic.
