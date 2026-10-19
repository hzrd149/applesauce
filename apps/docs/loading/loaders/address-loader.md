---
description: Load addressable Nostr events by kind, pubkey, and identifier with automatic relay discovery
---

# Address Loader

The Address Loader is a specialized loader for fetching Nostr replaceable events by their address (kind, pubkey, and optional identifier). It provides an efficient way to batch and deduplicate requests, cache results, and handle relay hints.

:::warning
The observable returned by the Address Loader MUST be subscribed to in order for the request to be made. No request will be sent until you call `.subscribe()` on the returned observable.
:::

## Basic Usage

```ts
import { createAddressLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

// Create a relay pool
const pool = new RelayPool();

// Create an address loader (do this once at the app level)
const addressLoader = createAddressLoader(pool);

// Later, use the loader to fetch events by address
addressLoader({
  kind: 0,
  pubkey: "user_pubkey",
  relays: ["wss://relay.example.com"],
}).subscribe((event) => {
  console.log("Loaded profile:", event);
});
```

## Configuration Options

The `createAddressLoader` function accepts these options:

- `bufferTime`: Time interval to buffer requests in ms (default 200)
- `bufferSize`: Max buffer size (default 200)
- `eventStore`: An event store used to deduplicate events (defaults to an internal `EventMemory`, `null` disables deduplication)
- `cacheRequest`: A method used to load events from a local cache
- `followRelayHints`: Whether to follow relay hints (default true)
- `extraRelays`: Relays to ask for pointers the cache and relay hints didn't resolve
- `lookupRelays`: Fallback relays to ask for pointers that are still unresolved after the extra relays
- `maxConcurrentBatches`: The maximum number of batches requesting relays at once (default 4)
- `stageTimeout`: Time in ms before a slow stage gives up and moves on to the next one, `0` disables it (default 10000)
- `signal`: An `AbortSignal` that tears down the loader

:::tip
Pass your app's `EventStore` as `eventStore` so loaded events are added to it, even if the requesting component unsubscribes first.
:::

## Working with Relay Pools

The Address Loader requires a request method for loading Nostr events from relays. You can provide this in multiple ways:

### Using a RelayPool instance

The simplest approach is to pass a RelayPool instance directly:

```ts
import { createAddressLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();
const addressLoader = createAddressLoader(pool, {
  eventStore,
  cacheRequest,
});
```

### Using a custom request method

You can also provide a custom request method, such as one from nostr-tools:

```ts
import { createAddressLoader } from "applesauce-loaders/loaders";
import { SimplePool } from "nostr-tools";
import { Observable } from "rxjs";

const pool = SimplePool();

// Create a custom request function using nostr-tools
function customRequest(relays, filters) {
  return new Observable((observer) => {
    const sub = pool.subscribeMany(relays, filters, {
      onevent: (event) => observer.next(event),
      eose: () => observer.complete(),
    });

    return () => sub.close();
  });
}

// Create address loader with custom request
const addressLoader = createAddressLoader(customRequest, options);
```

## Loading from cache

For improved performance, you can configure the loader to use a local cache:

```ts
import { createAddressLoader } from "applesauce-loaders/loaders";
import { openDB, getEventsForFilters } from "nostr-idb";

// Setup a local event cache
const cache = await openDB();

function cacheRequest(filters) {
  return getEventsForFilters(cache, filters);
}

const addressLoader = createAddressLoader(pool, {
  cacheRequest,
  eventStore,
});

// Events from cache are automatically marked using markFromCache
addressLoader({ kind: 0, pubkey: "user_pubkey" }).subscribe((event) => {
  if (!isFromCache(event)) {
    // This is a new event from the network
    addEvents(cache, [event]);
  }
});
```

## Real-World Example

Here's how you might use the Address Loader in a React application to load user profiles:

```tsx
import { EventStore } from "applesauce-core";
import { createAddressLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";
import { kinds } from "nostr-tools";
import { useEffect, useState } from "react";
import { EMPTY, ignoreElements, merge } from "rxjs";

// Setup at app level
const eventStore = new EventStore();
const pool = new RelayPool();
const addressLoader = createAddressLoader(pool, {
  eventStore,
  lookupRelays: ["wss://purplepag.es/"],
});

function ProfileComponent({ pubkey, relays }) {
  const [profile, setProfile] = useState(null);

  // Load the profile when component mounts
  useEffect(() => {
    // Check if we already have the profile
    if (eventStore.hasReplaceable(kinds.Metadata, pubkey)) {
      setProfile(eventStore.getLatestReplaceable(kinds.Metadata, pubkey));
      return;
    }

    // Load profile from the network
    const subscription = addressLoader({
      kind: kinds.Metadata,
      pubkey,
      relays,
    }).subscribe((event) => {
      setProfile(JSON.parse(event.content));
    });

    return () => subscription.unsubscribe();
  }, [pubkey]);

  if (!profile) return <div>Loading profile...</div>;

  return (
    <div>
      <h2>{profile.name || "Anonymous"}</h2>
      {profile.picture && <img src={profile.picture} alt="Profile" />}
      <p>{profile.about}</p>
    </div>
  );
}
```

## Loading Sequence

The Address Loader follows this sequence when loading events:

1. Attempt to load from cache (if configured)
2. Use relay hints from address pointers (if enabled)
3. Fetch from extra relays (if configured)
4. Try fallback lookup relays (if configured)

Each stage only receives the addresses earlier stages didn't find, and skips relays that were already asked for that address. A stage that takes longer than `stageTimeout` is ended so the next stage can run.

Each hinted relay is only asked for the addresses that hint it. Requesting an address that is already being loaded joins the running request, and if a relay limits how many results it returns, the missing addresses are requested again while each retry makes progress.
