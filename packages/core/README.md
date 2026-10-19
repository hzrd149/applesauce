# applesauce-core

Applesauce is a collection of utilities for building reactive nostr applications. The core package provides protocol-level functionality including an in-memory event database, generic event utilities, and basic reactive models.

## Key Components

- **Helpers**: Core utility methods for parsing and extracting data from nostr events
- **EventStore**: In-memory database for storing and subscribing to nostr events
- **Helpers**: Core protocol-level utility methods for working with events, tags, filters, and pointers
- **Models**: Generic models for common nostr data patterns (profiles, reactions, zaps, etc.)
- **Observable**: RxJS utilities for reactive programming

> **Note**: For NIP-specific helpers and models (NIP-10 threading, NIP-22 comments, NIP-53 streams, etc.), see the [`applesauce-common`](../common/README.md) package.

## Documentation

For detailed documentation and guides, visit:

- [Getting Started](https://applesauce.build/introduction/getting-started)
- [API Reference](https://applesauce.build/typedoc/)

## Example

```js
import { EventStore } from "applesauce-core";
import { ProfileModel, TimelineModel } from "applesauce-core/models";
import { Relay } from "nostr-tools/relay";

// Create a single EventStore instance for your app
const eventStore = new EventStore();

// Use any nostr library for relay connections (nostr-tools, ndk, nostrify, etc...)
const relay = await Relay.connect("wss://relay.example.com");

// Subscribe to events and add them to the store
const sub = relay.subscribe([{ authors: ["3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"] }], {
  onevent(event) {
    eventStore.add(event);
  },
});

// Subscribe to profile changes using ProfileModel
const profile = eventStore.model(ProfileModel, "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d");

profile.subscribe((parsed) => {
  if (parsed) console.log(parsed);
});

// Subscribe to a timeline of events
const timeline = eventStore.model(TimelineModel, { kinds: [1] });

timeline.subscribe((events) => {
  console.log(events);
});
```

## Optimistic verification

`OptimisticEventVerifier` provides a synchronous verification callback for `EventStore` or `AsyncEventStore`. It uses existing seen-relay metadata to gradually reduce signature checks while continuing to validate every event hash. Events without relay metadata receive full verification.

```ts
import { EventStore, OptimisticEventVerifier } from "applesauce-core";

const verifier = new OptimisticEventVerifier({ storage: localStorage });
const eventStore = new EventStore({ verifyEvent: verifier.verifyEvent });
```

The options object and its `storage` property are optional; omit storage for in-memory evidence. The adapter uses string-valued `getItem` and `setItem`, synchronously or asynchronously, so localStorage and localForage are supported. Reads happen lazily per relay, verification remains strict during loading, and writes are coalesced asynchronously.

Trust grows toward a 10% signature sampling floor after 10,000 successful checks across 14 days with at least 20 checks each, using a rolling 30-day evidence window. Multiple sources use the strictest sampling rate. Invalid events reset their sources' evidence. Recent duplicate checks are deduplicated with bounded caches; they do not repeatedly earn trust while cached.

Configure trust growth and resource limits through the constructor; these are the defaults:

```ts
const verifier = new OptimisticEventVerifier({
  storage: localStorage,
  minimumVerificationRate: 0.1,
  verifiedEventsForTrust: 10_000,
  daysForTrust: 14,
  verifiedEventsPerDay: 20,
  historyDays: 30,
  cacheSize: 10_000,
});
```

Lower `verifiedEventsForTrust` and `daysForTrust` to build trust faster. `verifiedEventsPerDay` controls which days qualify; `historyDays` controls evidence expiration and must be at least `daysForTrust`. Counts must be positive safe integers, and `minimumVerificationRate` must be greater than zero and at most one. A rate of one keeps signature verification enabled for every uncached event. Stored evidence is evaluated using the current options.

### Integration

Applesauce relays already attach seen-relay metadata before delivery. For another transport, pass its source URL to `eventStore.add(event, relayUrl)`. Share one verifier between stores to share evidence and avoid repeated signature checks.

Use `getRelayState(url)` for a current snapshot, or subscribe to `relays$` for discovered URLs and `relay$(url)` for a relay's trust, sampling probability, readiness, verified count, and rolling daily history. `trust$(url)` and `history$(url)` expose individual fields. Observing a relay starts loading its persisted evidence; historical data contains successful checks used for trust, rather than all received events.

```ts
const subscription = verifier.relay$(relayUrl).subscribe((state) => {
  console.log(state.trust, state.verificationProbability, state.history);
});
subscription.unsubscribe();
```

Snapshots are detached from internal evidence. Observables refresh on evidence changes, hydration, and UTC day boundaries while subscribed; unsubscribe when the view is removed.

### Best Practices

- Use optimistic verification only where accepting some unchecked signatures is appropriate; sampling cannot guarantee event authenticity.
- Keep full cryptographic verification for authorization and financial decisions. Optimistic acceptance never sets the cryptographic verification symbol.
- Treat seen-relay metadata as provenance supplied by your application, and do not copy it onto different event payloads.
- Existing store paths that bypass the verification callback, including deletion handling, are unaffected.
