---
description: Load zap events for a target with validation and relay routing
---

# Zaps Loader

The Zaps Loader is a specialized loader for fetching [NIP-57](https://github.com/nostr-protocol/nips/blob/master/57.md) zap events for any given Nostr event. It is built on top of the [Tag Value Loader](./tag-value-loader.md) and automatically handles both regular events and addressable events.

:::warning
The observable returned by the Zaps Loader MUST be subscribed to in order for the request to be made. No request will be sent until you call `.subscribe()` on the returned observable.
:::

## Basic Usage

```ts
import { createZapsLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

// Create a relay pool
const pool = new RelayPool();

// Create a zaps loader (do this once at the app level)
const zapsLoader = createZapsLoader(pool);

// Later, use the loader to fetch zaps for any event
const someEvent = { id: "event_id", kind: 1 /* ... */ };

zapsLoader(someEvent, ["wss://relay.example.com"]).subscribe((zapEvent) => {
  console.log("Received zap:", zapEvent);
});
```

## How It Works

The Zaps Loader automatically:

- Determines if the target event is addressable (replaceable) or a regular event
- Uses the appropriate tag (`a` for addressable events, `e` for regular events) to fetch zaps
- Merges relay hints from the event's seen relays (if `useSeenRelays` is enabled)
- Filters results to only return NIP-57 zap events (kind 9735)

## Configuration Options

The `createZapsLoader` function accepts these options:

- `useSeenRelays`: Whether to include relays where the event was seen (default `true`)
- All other options from Tag Value Loader: `bufferTime`, `bufferSize`, `authors`, `since`, `cacheRequest`, `extraRelays`, `eventStore`

```ts
const zapsLoader = createZapsLoader(pool, {
  useSeenRelays: true,
  bufferTime: 500,
  eventStore,
  cacheRequest,
});
```

## Example with React

```tsx
import { createZapsLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { useEffect, useState } from "react";

// Setup at app level
const pool = new RelayPool();
const zapsLoader = createZapsLoader(pool);

function ZapsComponent({ event }) {
  const [zaps, setZaps] = useState([]);

  useEffect(() => {
    const subscription = zapsLoader(event).subscribe((zapEvent) => {
      setZaps((prev) => [...prev, zapEvent]);
    });

    return () => subscription.unsubscribe();
  }, [event.id]);

  return (
    <div>
      <h3>Zaps ({zaps.length})</h3>
      {zaps.map((zap) => (
        <div key={zap.id}>
          <p>Zap amount: {/* parse zap amount from event */}</p>
        </div>
      ))}
    </div>
  );
}
```

## Addressable vs Regular Events

The loader automatically handles both types of events:

- **Regular events** (kind 0, 1, etc.): Uses `e` tags to find zaps
- **Addressable events** (kind 30000+): Uses `a` tags with the replaceable address

This abstraction means you don't need to worry about the event type - just pass any event to the loader.
