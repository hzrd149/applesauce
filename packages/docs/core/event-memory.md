# Event Memory

The `EventMemory` class is a specialized in-memory database that serves as a critical component within the `EventStore` architecture. Its primary role is to ensure there is only ever a single instance of each event in memory, preventing duplicates and enabling efficient caching mechanisms.

## Purpose

The EventMemory class addresses a fundamental challenge in Nostr applications: **event deduplication**. When events are received from multiple relays or processed multiple times, the same event can appear as different JavaScript objects in memory. This creates several problems:

1. **Memory waste** - Multiple copies of identical events consume unnecessary memory
2. **Cache invalidation** - Cached data attached to events becomes fragmented across duplicate instances
3. **Performance degradation** - Symbol-based caching mechanisms fail when events are duplicated

## How it Works

The EventMemory class maintains a single canonical instance of each event using its unique `id`. When an event is added:

```ts
const eventMemory = new EventMemory();

// First addition - event is stored
const original = eventMemory.add(event);

// Subsequent additions with same ID return the original instance
const duplicate = eventMemory.add(anotherEventInstance);
console.log(original === duplicate); // true
```

### Key Features

- **LRU Cache**: Uses an LRU (Least Recently Used) cache to manage memory efficiently
- **Event Indexing**: Maintains indexes by kind, author, tags, and creation time for fast lookups
- **Replaceable Event Support**: Handles replaceable events (kinds 0, 3, 1xxxx) with proper versioning
- **Claim System**: Tracks which events are actively being used to prevent premature garbage collection

## Integration with EventStore

The EventStore automatically creates an EventMemory instance and uses it to deduplicate events:

```ts
import { EventStore } from "applesauce-core";

const eventStore = new EventStore();

// Both calls return the same event instance
const event1 = eventStore.add(eventFromRelay1);
const event2 = eventStore.add(eventFromRelay2); // Same event, different relay

console.log(event1 === event2); // true - same instance
```

## Symbol-Based Caching

The applesauce-core package extensively uses Symbols to cache computed data on events during runtime. This approach provides significant performance benefits:

```ts
// Example: Caching parsed content
const ParsedContentSymbol = Symbol("parsedContent");

function getParsedContent(event: NostrEvent) {
  let parsed = Reflect.get(event, ParsedContentSymbol);
  if (!parsed) {
    parsed = JSON.parse(event.content);
    Reflect.set(event, ParsedContentSymbol, parsed);
  }
  return parsed;
}
```

### Why Single Instances Matter

When events are duplicated, cached data becomes fragmented:

```ts
// ❌ Problem: Multiple instances
const event1 = { id: "abc123", content: '{"name": "Alice"}' };
const event2 = { id: "abc123", content: '{"name": "Alice"}' }; // Duplicate

// Cache data on first instance
Reflect.set(event1, ParsedContentSymbol, { name: "Alice" });

// Second instance has no cached data - must parse again
const parsed1 = Reflect.get(event1, ParsedContentSymbol); // { name: "Alice" }
const parsed2 = Reflect.get(event2, ParsedContentSymbol); // undefined
```

```ts
// ✅ Solution: Single instance via EventMemory
const eventMemory = new EventMemory();
const canonicalEvent = eventMemory.add(event1);
const sameEvent = eventMemory.add(event2);

// Both references point to the same instance
console.log(canonicalEvent === sameEvent); // true

// Cache data once, available everywhere
Reflect.set(canonicalEvent, ParsedContentSymbol, { name: "Alice" });
const parsed = Reflect.get(sameEvent, ParsedContentSymbol); // { name: "Alice" }
```

## Memory Management

The EventMemory class includes sophisticated memory management features:

### Claim System

Events can be "claimed" to prevent them from being garbage collected:

```ts
const event = eventMemory.add(someEvent);

// Claim the event (prevents it from being pruned)
eventMemory.claim(event, subscription);

// Check if event is claimed
const isClaimed = eventMemory.isClaimed(event);

// Remove claim when done
eventMemory.removeClaim(event, subscription);
```

### Pruning

Unclaimed events can be automatically removed to free memory:

```ts
// Remove up to 100 unclaimed events
const removed = eventMemory.prune(100);

// Remove all unclaimed events
const removed = eventMemory.prune();
```

### LRU Behavior

The LRU cache ensures that frequently accessed events stay in memory while less-used events are evicted when memory limits are reached.

## Performance Benefits

The EventMemory class provides several performance advantages:

1. **Reduced Memory Usage**: Eliminates duplicate events
2. **Faster Computations**: Cached data persists across event references
3. **Efficient Indexing**: Multiple indexes enable fast filtering and searching
4. **Automatic Cleanup**: LRU and pruning prevent memory leaks

## Usage in Practice

Most applications don't interact directly with EventMemory - it's handled automatically by EventStore. However, understanding its role helps explain why the EventStore is so efficient at handling large numbers of events from multiple sources while maintaining good performance characteristics.

The EventMemory class is what makes applesauce-core's caching mechanisms work effectively, ensuring that expensive operations like content parsing, profile resolution, and other computations are performed only once per unique event, regardless of how many times that event is referenced throughout your application.
