---
description: Load reaction events for a target event with automatic relay routing and filtering
---

# Reactions Loader

The Reactions Loader is a specialized loader for fetching [NIP-25](https://github.com/nostr-protocol/nips/blob/master/25.md) reaction events for any given Nostr event. It is built on top of the [Tag Value Loader](./tag-value-loader.md) and automatically handles both regular events and addressable events.

:::warning
The observable returned by the Reactions Loader MUST be subscribed to in order for the request to be made. No request will be sent until you call `.subscribe()` on the returned observable.
:::

## Basic Usage

```ts
import { createReactionsLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

// Create a relay pool
const pool = new RelayPool();

// Create a reactions loader (do this once at the app level)
const reactionsLoader = createReactionsLoader(pool);

// Later, use the loader to fetch reactions for any event
const someEvent = { id: "event_id", kind: 1 /* ... */ };

reactionsLoader(someEvent, ["wss://relay.example.com"]).subscribe((reactionEvent) => {
  console.log("Received reaction:", reactionEvent);
});
```

## How It Works

The Reactions Loader automatically:

- Determines if the target event is addressable (replaceable) or a regular event
- Uses the appropriate tag (`a` for addressable events, `e` for regular events) to fetch reactions
- Merges relay hints from the event's seen relays (if `useSeenRelays` is enabled)
- Filters results to only return NIP-25 reaction events (kind 7)

## Configuration Options

The `createReactionsLoader` function accepts these options:

- `useSeenRelays`: Whether to include relays where the event was seen (default `true`)
- All other options from Tag Value Loader: `bufferTime`, `bufferSize`, `authors`, `since`, `cacheRequest`, `extraRelays`, `eventStore`

```ts
const reactionsLoader = createReactionsLoader(pool, {
  useSeenRelays: true,
  bufferTime: 500,
  eventStore,
  cacheRequest,
});
```

## Example with React

```tsx
import { createReactionsLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { useEffect, useState } from "react";

// Setup at app level
const pool = new RelayPool();
const reactionsLoader = createReactionsLoader(pool);

function ReactionsComponent({ event }) {
  const [reactions, setReactions] = useState([]);

  useEffect(() => {
    const subscription = reactionsLoader(event).subscribe((reactionEvent) => {
      setReactions((prev) => [...prev, reactionEvent]);
    });

    return () => subscription.unsubscribe();
  }, [event.id]);

  // Group reactions by content
  const reactionCounts = reactions.reduce((acc, reaction) => {
    const content = reaction.content || "+";
    acc[content] = (acc[content] || 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <h3>Reactions ({reactions.length})</h3>
      <div className="reactions-list">
        {Object.entries(reactionCounts).map(([emoji, count]) => (
          <span key={emoji} className="reaction-pill">
            {emoji} {count}
          </span>
        ))}
      </div>
    </div>
  );
}
```

## Understanding Reaction Events

NIP-25 reaction events have the following structure:

- **Kind**: 7 (reaction)
- **Content**: Usually an emoji (👍, ❤️, etc.) or "+" for likes, "-" for dislikes
- **Tags**: Include `e` or `a` tags referencing the reacted-to event

Example reaction event:

```json
{
  "kind": 7,
  "content": "🔥",
  "tags": [
    ["e", "event_id_being_reacted_to"],
    ["p", "pubkey_of_event_author"]
  ],
  "created_at": 1234567890,
  "pubkey": "reactor_pubkey"
}
```

## Addressable vs Regular Events

The loader automatically handles both types of events:

- **Regular events** (kind 0, 1, etc.): Uses `e` tags to find reactions
- **Addressable events** (kind 30000 to 39999): Uses `a` tags with the replaceable address

This abstraction means you don't need to worry about the event type - just pass any event to the loader.

## Advanced Example: Reaction Analytics

```tsx
import { createReactionsLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { useEffect, useState } from "react";

const pool = new RelayPool();
const reactionsLoader = createReactionsLoader(pool);

function ReactionAnalytics({ event }) {
  const [reactions, setReactions] = useState([]);
  const [uniqueReactors, setUniqueReactors] = useState(new Set());

  useEffect(() => {
    const subscription = reactionsLoader(event).subscribe((reaction) => {
      setReactions((prev) => [...prev, reaction]);
      setUniqueReactors((prev) => new Set([...prev, reaction.pubkey]));
    });

    return () => subscription.unsubscribe();
  }, [event.id]);

  const positiveReactions = reactions.filter((r) => r.content === "+" || r.content === "👍" || r.content === "❤️");

  const negativeReactions = reactions.filter((r) => r.content === "-" || r.content === "👎");

  return (
    <div>
      <h3>Reaction Summary</h3>
      <p>Total reactions: {reactions.length}</p>
      <p>Unique reactors: {uniqueReactors.size}</p>
      <p>Positive: {positiveReactions.length}</p>
      <p>Negative: {negativeReactions.length}</p>
    </div>
  );
}
```

## Performance Considerations

The Reactions Loader is optimized for performance through:

- **Batching**: Multiple reaction requests are automatically batched together
- **Deduplication**: Events are deduplicated when an event store is provided
- **Caching**: Local cache integration prevents unnecessary network requests
- **Relay optimization**: Uses seen relays from the target event for better discovery

For best performance, ensure you provide an `eventStore` and `cacheRequest` when creating the loader.
