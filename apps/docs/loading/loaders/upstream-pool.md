# Upstream Pool

The `UpstreamPool` interface provides a flexible way to use any relay library with Applesauce loaders. Both `createEventLoader` and `createAddressLoader` accept an `UpstreamPool`, which allows you to use `applesauce-relay`'s `RelayPool` by default, or adapt other relay libraries like `nostr-tools`' `SimplePool`, `@nostr-dev-kit/ndk`'s `NDK`, or `@nostrify/nostrify`'s `NPool`.

## Interface Definition

The `UpstreamPool` type is defined as:

```typescript
type NostrRequest = (relays: string[], filters: Filter[]) => Observable<NostrEvent>;

type UpstreamPool = NostrRequest | { request: NostrRequest };
```

This means you can provide either:

1. **A function directly** that matches the `NostrRequest` signature
2. **An object** with a `request` method that matches the `NostrRequest` signature

## Using RelayPool (Default)

The `RelayPool` from `applesauce-relay` implements the `UpstreamPool` interface by providing a `request` method:

```ts
import { createEventLoader, createAddressLoader } from "applesauce-loaders/loaders";
import { RelayPool } from "applesauce-relay";

const pool = new RelayPool();

// RelayPool has a request method, so it works directly
const eventLoader = createEventLoader(pool);
const addressLoader = createAddressLoader(pool);
```

The `RelayPool.request()` method signature matches `NostrRequest`:

- Takes an array of relay URLs and an array of filters
- Returns an `Observable<NostrEvent>`
- Automatically handles deduplication and connection management

## Using nostr-tools SimplePool

To use `nostr-tools`' `SimplePool`, you need to create an adapter function that converts its API to the `NostrRequest` signature:

```ts
import { createEventLoader } from "applesauce-loaders/loaders";
import { UpstreamPool } from "applesauce-loaders";
import { mergeFilters, SimplePool } from "nostr-tools";
import { Observable } from "rxjs";
import type { Filter, NostrEvent } from "applesauce-core";

const pool = new SimplePool();

// Create an adapter function
const upstream: UpstreamPool = (relays, filters) =>
  new Observable((observer) => {
    const sub = pool.subscribe(relays, mergeFilters(...filters), {
      onevent: (event) => observer.next(event),
      oneose: () => observer.complete(),
      onclose: (reasons) => {
        if (reasons && reasons.length > 0) {
          observer.error(new Error(reasons.join(", ")));
        } else {
          observer.complete();
        }
      },
    });

    return () => sub.close();
  });

// Use the adapter function directly
const eventLoader = createEventLoader(upstream);
```

Note: `SimplePool.subscribe()` expects a single merged filter, so we use `mergeFilters(...filters)` to combine multiple filters. The `onclose` handler completes the observable normally or errors if there are close reasons.

## Using NDK

To use `@nostr-dev-kit/ndk`'s `NDK`, you need to create an adapter function that converts its Promise-based API to an Observable:

```ts
import NDK from "@nostr-dev-kit/ndk";
import { createEventLoader } from "applesauce-loaders/loaders";
import { UpstreamPool } from "applesauce-loaders";
import { from, map, switchMap } from "rxjs";
import type { Filter, NostrEvent } from "applesauce-core";

const ndk = new NDK();
await ndk.connect();

// Create an adapter function
const upstream: UpstreamPool = (relays, filters) =>
  from(ndk.fetchEvents(filters, { relayUrls: relays })).pipe(
    // Emit each event individually
    switchMap((events) => from(events)),
    // Get raw event from NDKEvent
    map((event) => event.rawEvent()),
  );

// Use the adapter function directly
const eventLoader = createEventLoader(upstream);
```

Note: `NDK.fetchEvents()` returns a Promise that resolves with an array of `NDKEvent` objects. We use RxJS `from()` to convert the Promise to an Observable, `switchMap()` with `from()` to emit each event individually, and `map()` to call `rawEvent()` on each event to get the raw `NostrEvent` that the loader expects.

## Using nostrify NPool

To use `@nostrify/nostrify`'s `NPool`, you need to create an adapter function that converts its async iterable API to an Observable:

```ts
import { NPool, NRelay1 } from "@nostrify/nostrify";
import { createEventLoader } from "applesauce-loaders/loaders";
import { UpstreamPool } from "applesauce-loaders";
import { from, map, takeWhile } from "rxjs";
import type { Filter, NostrEvent } from "applesauce-core";

const pool = new NPool({
  open: (url) => new NRelay1(url),
  reqRouter(_filters) {
    // skip implementing reqRouter for now
    return new Map();
  },
  eventRouter(_event) {
    // skip implementing eventRouter for now
    return [];
  },
});

// Create an adapter function
const upstream: UpstreamPool = (relays, filters) =>
  // Convert async iterable to observable
  from(pool.req(filters, { relays })).pipe(
    // Complete when EOSE or CLOSED is received
    takeWhile((msg) => msg[0] !== "EOSE" && msg[0] !== "CLOSED"),
    // Select event from message tuple [type, subscriptionId, event]
    map((msg) => msg[2]),
  );

// Use the adapter function directly
const eventLoader = createEventLoader(upstream);
```

Note: `NPool.req()` returns an async iterable of message tuples `[type, subscriptionId, event]`. We use RxJS `from()` to convert it to an Observable, `takeWhile()` to complete when EOSE or CLOSED is received, and `map()` to extract the event from the tuple.

## Key Requirements

When creating an adapter for a relay library, ensure your `NostrRequest` function:

1. **Accepts the correct parameters**: `(relays: string[], filters: Filter[])`
2. **Returns an Observable**: `Observable<NostrEvent>`
3. **Emits events**: Call `observer.next(event)` for each event received
4. **Completes on EOSE**: Call `observer.complete()` when the relay sends EOSE
5. **Handles errors**: Call `observer.error(error)` on subscription errors
6. **Cleans up**: Return a cleanup function from the Observable that closes subscriptions

## Benefits of This Design

The `UpstreamPool` interface provides several benefits:

- **Flexibility**: Use any relay library that can be adapted to the interface
- **Interoperability**: Easy to switch between relay libraries or use multiple ones
- **Testability**: Easy to mock for testing by providing a simple function
- **Simplicity**: The interface is minimal and focused on what loaders need

This design allows Applesauce loaders to work with the ecosystem of Nostr relay libraries while maintaining a clean, consistent API.
